# MemoryAI

**Persistent memory layer for LLMs.** Gives AI models (Claude, Gemini, GPT, Ollama) access to facts, decisions, and context from previous sessions — automatically, without user prompting.

> "Why does your AI forget what you agreed on yesterday?" — MemoryAI solves this by acting as an external, queryable brain for any LLM.

Self-hosted · PostgreSQL + pgvector · BullMQ · MCP + REST API · Multi-provider embeddings

---

## Table of Contents

- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [IDE Integration](#ide-integration)
  - [Universal Installer](#universal-installer)
  - [Manual Configuration per IDE](#manual-configuration-per-ide)
- [Remote Access via Tailscale](#remote-access-via-tailscale)
- [Configuration](#configuration)
- [MCP Tools Reference](#mcp-tools-reference)
- [REST API Reference](#rest-api-reference)
- [Memory Types and Importance Scale](#memory-types-and-importance-scale)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [System Requirements](#system-requirements)
- [Resource Estimates](#resource-estimates)
- [Distillation Details](#distillation-details)
- [Security](#security)
- [Roadmap](#roadmap)
- [License](#license)

---

## How It Works

LLMs are **stateless** — every session starts from zero. MemoryAI adds a persistent memory layer between your IDE/agent and the model:

```
┌─────────────────────────────────────────────────────────┐
│           ANTIGRAVITY / CLAUDE CODE / ANY LLM            │
│  Model sees MCP tools → calls them automatically         │
└────────────────────────┬────────────────────────────────┘
                         │  MCP (HTTP/SSE) or REST API
┌────────────────────────▼────────────────────────────────┐
│               MemoryAI Server (Node.js + Fastify)        │
│                                                          │
│  ① session start   → memory_get_context()               │
│     returns relevant past facts injected into context   │
│                                                          │
│  ② during session  → memory_save() / entity_save()      │
│     model stores facts, decisions, preferences           │
│                                                          │
│  ③ session end     → session_end()                      │
│     triggers background LLM distillation of full conv   │
└──────┬──────────────────┬──────────────────────────────┘
       │                  │
┌──────▼──────┐   ┌───────▼──────────┐
│ PostgreSQL  │   │   Redis          │
│ + pgvector  │   │   BullMQ queue   │
│             │   │   session cache  │
│ memories    │   └──────────────────┘
│ sessions    │            │
│ entities    │   ┌────────▼─────────┐
│ users       │   │ Distillation LLM │
└─────────────┘   │ (Ollama/Gemini/  │
                  │  Anthropic)      │
                  └──────────────────┘
```

### Automatic memory flow — zero user effort

| Step | What happens | Who triggers it |
|------|-------------|-----------------|
| Conversation starts | `memory_get_context` called → top-K relevant memories injected into context | Model (auto via MCP tool description) |
| During conversation | `memory_save`, `entity_save` called for important facts | Model (auto judgment) |
| Session ends or 15 min idle | Background worker distills full conversation → extracts structured facts | Server (inactivity timer, no user action) |
| Next conversation | Model has full context from previous session | — |

### Hybrid search

Memories are retrieved using a weighted combination of three signals, executed in a single PostgreSQL query:

| Signal | Weight | Method |
|--------|--------|--------|
| Semantic similarity | 70% | Cosine distance via pgvector |
| Full-text match | 20% | BM25 / tsvector |
| Importance score | 10% | User-defined or LLM-assigned (0.0–1.0) |

---

## Quick Start

### 1. Clone and run setup

```bash
git clone https://github.com/cenkierpiotr/memoryai
cd memoryai
bash scripts/setup.sh
```

The `setup.sh` script does the following automatically:

- Generates `.env` with cryptographically random secrets
- Starts PostgreSQL 16 + pgvector and Redis 7 via Docker Compose
- Detects installed Ollama models and configures the best available one
- Configures MCP in Antigravity (`~/.gemini/antigravity/mcp_config.json`)
- Configures MCP in Claude Code (`~/.claude/settings.json`)

### 2. Start the server

```bash
# With Docker Compose (recommended — includes PostgreSQL + Redis)
docker compose -f docker/docker-compose.yml up -d

# Local development (PostgreSQL and Redis must already be running)
npm install
npm run dev -w packages/api
```

### 3. Verify health

```bash
curl http://localhost:3001/health
# {"status":"ok","version":"0.1.0","timestamp":"..."}
```

### 4. Reload your IDE

After setup, restart your IDE or reload the MCP server to load the new configuration. AI models will automatically have access to all six memory tools.

---

## IDE Integration

### Universal Installer

A single Python script auto-detects all installed IDEs and writes the correct MCP configuration for each. Works on Linux, macOS, and Windows without any dependencies beyond Python 3.

**Linux / macOS:**
```bash
curl -sL https://your-server/dashboard/install.py | python3
```

**Windows (PowerShell):**
```powershell
python3 -c "import urllib.request; exec(urllib.request.urlopen('https://your-server/dashboard/install.py').read())"
```

Replace `your-server` with your MemoryAI host (e.g. `localhost:3001` or your Tailscale Funnel URL).

**Installer options:**

| Flag | Description |
|------|-------------|
| `--force` | Overwrite existing MCP entries without prompting |
| `--check` | Dry-run — detect IDEs and validate configs without writing |
| `--list` | Only detect installed IDEs, print paths, and exit |

**Example:**
```bash
curl -sL https://your-server/dashboard/install.py | python3 -- --check
```

The installer writes the MCP server URL (including your API key in the `Authorization` header) to each detected IDE's config file. Config paths are platform-aware:

| IDE | Linux config path | Windows config path | macOS config path |
|-----|-------------------|---------------------|-------------------|
| Cursor | `~/.cursor/mcp.json` | `%USERPROFILE%\.cursor\mcp.json` | `~/.cursor/mcp.json` |
| VS Code | `~/.config/Code/User/mcp.json` | `%APPDATA%\Code\User\mcp.json` | `~/Library/Application Support/Code/User/mcp.json` |
| Windsurf | `~/.windsurf/mcp.json` | `%USERPROFILE%\.windsurf\mcp.json` | `~/.windsurf/mcp.json` |
| Continue.dev | `~/.continue/config.json` | `%USERPROFILE%\.continue\config.json` | `~/.continue/config.json` |
| Claude Desktop | `~/.config/Claude/claude_desktop_config.json` | `%APPDATA%\Claude\claude_desktop_config.json` | `~/Library/Application Support/Claude/claude_desktop_config.json` |

---

### Manual Configuration per IDE

All manual configs require your API key. Get it from `.env` (`ADMIN_API_KEY`) or create one via the REST API.

#### Cursor

`~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "memoryai": {
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

#### VS Code (with MCP extension)

`~/.config/Code/User/mcp.json` (Linux) or `%APPDATA%\Code\User\mcp.json` (Windows):
```json
{
  "servers": {
    "memoryai": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

#### Windsurf

`~/.windsurf/mcp.json`:
```json
{
  "mcpServers": {
    "memoryai": {
      "serverUrl": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

#### Continue.dev

`~/.continue/config.json` — add to the `mcpServers` array:
```json
{
  "mcpServers": [
    {
      "name": "memoryai",
      "transport": {
        "type": "http",
        "url": "http://localhost:3001/mcp",
        "headers": {
          "Authorization": "Bearer YOUR_API_KEY"
        }
      }
    }
  ]
}
```

#### Claude Desktop

Platform-specific path:
- **Linux:** `~/.config/Claude/claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "memoryai": {
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

#### Antigravity (Google)

`~/.gemini/antigravity/mcp_config.json`:
```json
{
  "mcpServers": {
    "memoryai": {
      "serverUrl": "http://localhost:3001/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

#### Claude Code (CLI)

`~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "memoryai": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

#### Get ready-to-paste config via API

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3001/mcp/config
```

Returns a JSON object with config snippets for all supported IDEs.

---

## Remote Access via Tailscale

MemoryAI can be exposed publicly over HTTPS using **Tailscale Funnel**, making it accessible from any machine (home, work laptop, mobile) without a VPN client.

### Setup

```bash
# Expose port 3001 via Tailscale Serve (your Tailnet only)
tailscale serve --bg 3001

# Make it publicly accessible via Tailscale Funnel (public HTTPS)
tailscale funnel --bg 3001
```

After running these commands, your MemoryAI server is available at:

```
https://your-device.tailfbeb53.ts.net/mcp
```

Use this URL instead of `http://localhost:3001/mcp` in all IDE configs. The connection is TLS-terminated by Tailscale infrastructure — no certificate management needed on your end.

### Use case

This is particularly useful when:
- You work across multiple machines and want a single shared memory server
- You want to access memories from a mobile device or remote agent
- You run MemoryAI on a home server (e.g. Dell/NAS) and access it from your laptop

### Security note

Tailscale Funnel makes the endpoint publicly routable. MemoryAI requires a valid API key on every request, so unauthorized access is blocked at the application layer. Rotate your API key if you suspect compromise.

---

## Configuration

All configuration is via environment variables. Run `bash scripts/setup.sh` to generate `.env` with random secrets.

### Required variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (`postgres://user:pass@host:5432/db`) |
| `REDIS_URL` | Redis connection string (`redis://:password@host:6379`) |
| `JWT_SECRET` | Secret for JWT signing — minimum 32 characters |
| `ADMIN_API_KEY` | Master API key for the initial admin user |
| `POSTGRES_PASSWORD` | PostgreSQL password (used by Docker Compose) |
| `REDIS_PASSWORD` | Redis password (used by Docker Compose) |

### Embedding provider

Embeddings convert text into vectors for semantic search. Choose one provider:

```env
# Ollama — local, private, no API cost (default)
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text   # or bge-m3 for better Polish/multilingual support
EMBED_DIMENSIONS=768                   # set to 1024 when using bge-m3

# Google Gemini
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_EMBED_MODEL=text-embedding-004

# OpenAI
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your_key_here
OPENAI_EMBED_MODEL=text-embedding-3-small
```

### Distillation LLM

The distillation LLM reads raw session messages and extracts structured facts. Called in the background after sessions end.

```env
# Local Ollama — private, no API cost
DISTILL_PROVIDER=ollama
DISTILL_MODEL=qwen2.5:7b              # recommended; use qwen2.5:3b for less RAM

# Google Gemini Flash — fast, low cost per session
DISTILL_PROVIDER=gemini
DISTILL_MODEL=gemini-2.0-flash-exp
GEMINI_API_KEY=your_key_here

# Anthropic Claude Haiku — highest extraction quality
DISTILL_PROVIDER=anthropic
DISTILL_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=your_key_here
```

### Distillation schedule

```env
# Trigger distillation after N minutes of session inactivity (default: 15)
DISTILL_INACTIVITY_MINUTES=15

# Also trigger after every N messages regardless of time (0 = disabled)
DISTILL_EVERY_N_MESSAGES=50
```

### Rate limiting

```env
# Maximum requests per minute per API key (default: 10000)
RATE_LIMIT_RPM=10000
```

### Network and CORS

```env
PORT=3001
HOST=0.0.0.0

# Comma-separated list of allowed CORS origins
CORS_ORIGINS=http://localhost:3000,https://your-app.example.com
```

---

## MCP Tools Reference

Six tools exposed via MCP. Tool descriptions are written as behavioral instructions so models call them automatically — no explicit user prompting required.

### `memory_get_context`

**Auto-trigger:** Start of every conversation.

Loads the top-K memories most relevant to the current session context. Returns a formatted block injected into the model's context window.

```json
{
  "query": "current project and user preferences",
  "limit": 10,
  "session_id": "optional-existing-session-id"
}
```

Returns: array of memories with content, type, importance, and tags.

---

### `memory_save`

**Auto-trigger:** After the model learns something important.

Saves a single memory. The model is expected to call this when it encounters facts, decisions, or preferences worth persisting.

```json
{
  "content": "User prefers TypeScript strict mode in all new projects",
  "type": "preference",
  "importance": 0.8,
  "tags": ["typescript", "coding-style"],
  "session_id": "current-session-id"
}
```

---

### `memory_search`

**Auto-trigger:** When the model needs to look up specific past information.

Targeted semantic search across all stored memories. More focused than `memory_get_context`.

```json
{
  "query": "database architecture decisions",
  "limit": 5,
  "type": "decision"
}
```

---

### `entity_save`

**Auto-trigger:** When the model learns about a person, project, company, or system.

Creates or updates an entity in the knowledge base (upsert by name). Entities accumulate facts over multiple sessions.

```json
{
  "name": "Dell server",
  "type": "system",
  "facts": [
    "IP 100.99.158.2 via Tailscale",
    "Runs Docker, Ollama, n8n",
    "Primary deployment target for self-hosted projects"
  ]
}
```

Entity types: `person`, `project`, `company`, `system`, `other`.

---

### `entity_get`

**Auto-trigger:** When the model needs to recall information about a known entity.

Retrieves all stored facts for a named entity.

```json
{
  "name": "Dell server"
}
```

---

### `session_end`

**Auto-trigger:** When the user says goodbye, closes the chat, or signals end of work.

Closes the current session and queues background distillation. Also called automatically by the inactivity timer after `DISTILL_INACTIVITY_MINUTES` of no activity.

```json
{
  "session_id": "current-session-id",
  "summary": "Optional brief summary of what was accomplished"
}
```

---

## REST API Reference

All endpoints require: `Authorization: Bearer YOUR_API_KEY`

Base URL: `http://localhost:3001` (or your remote URL)

### Memories

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/memories/search` | Hybrid semantic search |
| `GET` | `/v1/memories` | List memories (paginated) |
| `POST` | `/v1/memories` | Create a single memory |
| `POST` | `/v1/memories/batch` | Bulk create (max 50 per request) |
| `GET` | `/v1/memories/:id` | Get memory by ID |
| `PATCH` | `/v1/memories/:id` | Update memory |
| `DELETE` | `/v1/memories/:id` | Delete memory |

**Search:**
```bash
curl -X POST http://localhost:3001/v1/memories/search \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "PostgreSQL database decisions", "limit": 5, "type": "decision"}'
```

**Create:**
```bash
curl -X POST http://localhost:3001/v1/memories \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Decided to use PostgreSQL with pgvector instead of a dedicated vector DB",
    "type": "decision",
    "importance": 0.9,
    "tags": ["project:memoryai", "tech:postgresql"]
  }'
```

**Batch create:**
```bash
curl -X POST http://localhost:3001/v1/memories/batch \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "memories": [
      {"content": "User uses pnpm as package manager", "type": "preference", "importance": 0.6},
      {"content": "Node.js 20 LTS on all servers", "type": "fact", "importance": 0.7}
    ]
  }'
```

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/sessions` | List sessions (paginated) |
| `POST` | `/v1/sessions` | Create new session |
| `GET` | `/v1/sessions/:id` | Get session details |
| `GET` | `/v1/sessions/:id/messages` | Get session message history |
| `POST` | `/v1/sessions/:id/messages` | Add message to session |
| `POST` | `/v1/sessions/:id/close` | Close session + trigger distillation |

**Create session:**
```bash
curl -X POST http://localhost:3001/v1/sessions \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"context": "Working on MemoryAI dashboard feature"}'
```

**Add message:**
```bash
curl -X POST http://localhost:3001/v1/sessions/SESSION_ID/messages \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"role": "user", "content": "Lets use React + Vite for the dashboard"}'
```

### Entities

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/entities/search` | Semantic entity search |
| `GET` | `/v1/entities` | List entities |
| `POST` | `/v1/entities` | Create/update entity (upsert by name) |
| `GET` | `/v1/entities/by-name/:name` | Get entity by name |
| `POST` | `/v1/entities/:id/facts` | Add fact to existing entity |
| `DELETE` | `/v1/entities/:id` | Delete entity |

**Create entity:**
```bash
curl -X POST http://localhost:3001/v1/entities \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Dell server",
    "type": "other",
    "facts": [
      {"content": "IP 100.99.158.2 via Tailscale"},
      {"content": "Runs Docker, Ollama, and n8n"},
      {"content": "Main deployment target for self-hosted projects"}
    ]
  }'
```

### System

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/mcp/config` | Get IDE config snippets for all supported clients |

---

## Memory Types and Importance Scale

### Memory types

| Type | Purpose | Example |
|------|---------|---------|
| `fact` | General factual information | "User uses TypeScript for all new projects" |
| `decision` | A choice that was made, with context | "Decided to use PostgreSQL over MongoDB — pgvector support was the deciding factor" |
| `preference` | What the user likes or dislikes | "User prefers concise responses without trailing summaries" |
| `instruction` | A rule to always follow | "Always write commit messages in English" |
| `entity_relation` | Relationship between two things | "cenkier.pl is deployed on LH.pl via FTP" |
| `summary` | High-level session overview | "Session 2026-06-01: Designed MemoryAI architecture, chose Fastify + pgvector" |

### Importance scale

| Range | Label | When to use |
|-------|-------|-------------|
| `0.9–1.0` | Critical | Must-follow instructions, irreversible decisions, key credentials |
| `0.7–0.8` | Important | Frequent preferences, project-level facts, active constraints |
| `0.5–0.6` | Normal | General context, background information |
| `0.3–0.4` | Low | Minor details, likely-outdated info |

Higher importance memories rank higher in hybrid search regardless of semantic relevance. Use `1.0` sparingly — reserve it for instructions the model must never violate.

---

## Architecture

### Component overview

```
memoryai/
├── packages/
│   ├── api/           Node.js + TypeScript + Fastify 5
│   │   └── src/
│   │       ├── config.ts            Env config + Zod validation
│   │       ├── index.ts             Server entrypoint + graceful shutdown
│   │       ├── db/pool.ts           PostgreSQL connection pool
│   │       ├── middleware/          Auth middleware (API key → user lookup)
│   │       ├── routes/              REST endpoints (memories, sessions, entities)
│   │       ├── services/            Business logic layer
│   │       │   ├── memory.service   CRUD + hybrid search
│   │       │   ├── session.service  Session lifecycle + message buffer
│   │       │   ├── entity.service   Entity upsert + vector search
│   │       │   ├── embedding.service  Multi-provider abstraction
│   │       │   └── auth.service     API key management
│   │       ├── mcp/server.ts        MCP JSON-RPC over HTTP/SSE
│   │       └── jobs/
│   │           ├── distillation.queue  BullMQ queue definition
│   │           └── distillation.worker Auto fact extraction scheduler
│   ├── dashboard/     React + Vite frontend (in development)
│   ├── sdk/           TypeScript client SDK (in development)
│   └── shared/        TypeScript types shared across packages
├── docker/
│   ├── docker-compose.yml   PostgreSQL 16+pgvector, Redis 7, API service
│   ├── Dockerfile.api       Multi-stage production Docker build
│   └── postgres/init.sql    DB schema, indexes, search functions
└── scripts/
    ├── setup.sh             First-time setup automation
    └── create-vector-index.sh  Optional: build HNSW index after data load
```

### Database schema

```sql
users             -- API keys, multi-user support
projects          -- optional namespacing for memories
sessions          -- conversation tracking (open/closed/distilled)
session_messages  -- raw message buffer used for distillation input
memories          -- persistent facts with vector embeddings + BM25 index
entities          -- named entities: people, projects, companies, systems
distillation_jobs -- async job tracking (BullMQ job IDs, status, errors)
```

### Tech stack

| Layer | Technology |
|-------|-----------|
| API server | Node.js 20 + TypeScript + Fastify 5 |
| Database | PostgreSQL 16 + pgvector extension |
| Cache / Queue | Redis 7 + BullMQ |
| MCP transport | HTTP + SSE (JSON-RPC 2.0) |
| Input validation | Zod |
| Container | Docker Compose |
| Embeddings | Ollama / Gemini / OpenAI (configurable) |
| Distillation | Ollama / Gemini Flash / Anthropic Claude Haiku (configurable) |

---

## Project Structure

```
memoryai/
├── .env.example                     All configuration variables documented
├── docker/
│   ├── docker-compose.yml           PostgreSQL + Redis + API services
│   ├── Dockerfile.api               Multi-stage production build
│   └── postgres/
│       └── init.sql                 DB schema, vector indexes, search functions
├── packages/
│   ├── shared/                      Shared TypeScript types (Memory, Session, Entity)
│   ├── api/
│   │   └── src/
│   │       ├── config.ts            Typed env config with startup validation
│   │       ├── index.ts             Fastify app + graceful shutdown handler
│   │       ├── db/pool.ts           PostgreSQL pool + transaction helper
│   │       ├── middleware/
│   │       │   └── auth.middleware.ts   API key → User lookup
│   │       ├── routes/
│   │       │   ├── memories.route.ts    /v1/memories (CRUD + search)
│   │       │   ├── sessions.route.ts    /v1/sessions (lifecycle + messages)
│   │       │   └── entities.route.ts    /v1/entities (upsert + search)
│   │       ├── services/
│   │       │   ├── memory.service.ts    Core memory CRUD + hybrid search
│   │       │   ├── session.service.ts   Session lifecycle + message buffer
│   │       │   ├── entity.service.ts    Entity upsert + vector search
│   │       │   ├── embedding.service.ts Multi-provider embedding abstraction
│   │       │   └── auth.service.ts      API key creation + validation
│   │       ├── mcp/
│   │       │   └── server.ts            MCP JSON-RPC over HTTP/SSE (6 tools)
│   │       └── jobs/
│   │           ├── distillation.queue.ts   BullMQ queue definition
│   │           └── distillation.worker.ts  Background LLM extraction + scheduler
│   ├── dashboard/                   React + Vite admin UI (in development)
│   └── sdk/                         @memoryai/client TypeScript SDK (in development)
├── scripts/
│   ├── setup.sh                     First-time setup automation
│   └── create-vector-index.sh       Build HNSW index after bulk import
└── README.md
```

---

## System Requirements

### Minimum (development / light use)

| Component | Minimum |
|-----------|---------|
| CPU | 2 cores |
| RAM | **2 GB** (PostgreSQL 512 MB + Redis 256 MB + API 256 MB) |
| Disk | **5 GB** (DB + indexes + logs) |
| Node.js | **20 LTS** |
| Docker | 24+ with Compose v2 |
| PostgreSQL | 16+ via `pgvector/pgvector:pg16` image |
| Redis | 7+ |

### Recommended (production / heavy use)

| Component | Recommended |
|-----------|-------------|
| CPU | 4+ cores |
| RAM | **8 GB** (headroom for large embedding batches + pgvector HNSW index) |
| Disk | **50+ GB SSD** (grows with memories; 768-dim vector ≈ 3 KB/memory) |
| Node.js | 20 LTS |

### Ollama models (local embeddings + distillation)

| Model | Type | VRAM / RAM | Notes |
|-------|------|-----------|-------|
| `nomic-embed-text` | Embedding | 274 MB | Default — good quality, English + Polish |
| `bge-m3` | Embedding | 570 MB | Best for multilingual / Polish-heavy content |
| `qwen2.5:7b` | Distillation | 4.7 GB | Recommended — strong fact extraction |
| `qwen2.5:3b` | Distillation | 2.0 GB | Lighter alternative, slightly lower quality |
| `llama3.2:3b` | Distillation | 2.0 GB | English-focused alternative |

> Ollama loads models on demand and unloads them after the idle timeout. Running embedding + distillation simultaneously requires approximately 5–6 GB RAM/VRAM with the recommended models.

---

## Resource Estimates

### Storage growth

| Metric | Size |
|--------|------|
| 1 memory (768-dim vector + text) | ~3–4 KB in PostgreSQL |
| 1,000 memories | ~4 MB |
| 10,000 memories | ~40 MB |
| 100,000 memories | ~400 MB |
| 1 session (50 messages) | ~50–200 KB |

After 1 year of active daily use (10 sessions/day, 5 memories extracted per session): **~18,000 memories ≈ ~72 MB**. Entirely manageable on any modern system.

### Runtime memory usage

| Service | Idle RAM | Peak RAM |
|---------|----------|----------|
| PostgreSQL + pgvector | ~100 MB | ~512 MB |
| Redis | ~10 MB | ~256 MB |
| MemoryAI API | ~80 MB | ~200 MB |
| Ollama (nomic-embed-text loaded) | ~300 MB | ~500 MB |
| **Total** | **~490 MB** | **~1.5 GB** |

### Network latency

| Operation | Typical latency |
|-----------|----------------|
| Embedding (local Ollama) | 10–50 ms |
| Embedding (Gemini API) | 100–300 ms |
| Distillation (Gemini Flash) | 500–2000 ms/session |
| Distillation (local qwen2.5:7b, CPU) | 5–30 s/session |
| Distillation (local qwen2.5:7b, GPU) | 1–5 s/session |
| Hybrid search query (PostgreSQL) | 5–20 ms |

---

## Distillation Details

Distillation is the process of converting raw session message history into structured, persistent memories. It runs in the background via BullMQ + Redis and does not block the API.

### Triggers

Distillation is triggered by either of two conditions — whichever comes first:

1. **Inactivity timer:** `DISTILL_INACTIVITY_MINUTES` (default: 15) minutes with no new messages in the session
2. **Message count:** Every `DISTILL_EVERY_N_MESSAGES` messages (if configured)

### Process

1. Session is marked as `distilling`
2. BullMQ worker picks up the job from the Redis queue
3. Worker fetches all `session_messages` for the session
4. LLM prompt asks the distillation model to extract: facts, decisions, preferences, instructions, entity relations
5. Extracted items are saved as `memories` and `entities` with appropriate types and importance scores
6. Session is marked as `distilled`
7. Raw messages are optionally pruned (configurable) to save storage

### Bug fix note

BullMQ job IDs cannot contain colons (`:`) — they are used as Redis key separators. All distillation job IDs use a dash separator: `distill-${sessionId}` instead of `distill:${sessionId}`.

### Quality tips

- **Gemini Flash** is the best price/quality ratio for distillation in most cases
- **Anthropic Claude Haiku** produces the most structured and tagged output
- **Local qwen2.5:7b** is fully private and surprisingly good for Polish content
- Keep sessions focused — distillation quality degrades with very long, context-switching conversations
- The distillation prompt is in `packages/api/src/jobs/distillation.worker.ts` and can be customized

---

## Security

### Authentication

- All REST and MCP endpoints require `Authorization: Bearer <key>`
- API keys are cryptographically random 48-character strings (nanoid)
- The admin key is set at startup via `ADMIN_API_KEY` — rotate it by updating the env var and restarting

### Data isolation

- Every database query is scoped by `user_id` — no cross-user data leakage
- `session_end` verifies session ownership before closing
- `addMessage` verifies session ownership inside a transaction

### SQL injection prevention

- All queries use **parameterized statements** exclusively — no string interpolation in SQL
- Zod validates all inputs before they reach the service layer
- Enum values (`type`, `status`) are validated by Zod, not interpolated into queries

### Input validation

- All REST endpoints validated with Zod schemas at the route level
- MCP tool arguments validated with explicit type checking before processing
- String length limits enforced: content max 10,000 characters

### Rate limiting

- Default: 10,000 requests/minute per API key
- Configurable via `RATE_LIMIT_RPM` environment variable
- Redis-backed via `@fastify/rate-limit`

### Security headers

- `@fastify/helmet` adds standard HTTP security headers (CSP, HSTS, X-Frame-Options, etc.)
- CORS restricted to explicit allowed origins via `CORS_ORIGINS` env var

### What is not included (v0.1)

- User registration UI (admin creates users via REST API)
- OAuth2 / SSO login
- Memory encryption at rest (use disk encryption at infrastructure level)
- Audit logs

---

## Roadmap

- [ ] **React Dashboard** (`packages/dashboard`) — browse memories, edit, search, view distillation jobs, analytics
- [ ] **Universal IDE Installer** (`/dashboard/install.py`) — auto-detect IDEs and write MCP configs
- [ ] **TypeScript SDK** (`packages/sdk`, `@memoryai/client`) — easy integration in any Node.js application
- [ ] **Python SDK** (`memoryai`) — for Python environments, Jupyter notebooks, LangChain
- [ ] **Proxy middleware** — transparent OpenAI-compatible API proxy that injects memory context automatically
- [ ] **Memory consolidation** — periodic deduplication and merging of similar memories
- [ ] **Multi-user management** — admin UI, user registration, per-user memory quotas
- [ ] **Export / import** — backup and restore memories as portable JSON
- [ ] **Memory decay** — reduce importance of old, unused memories automatically

---

## License

MIT
