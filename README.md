# MemoryAI

**Persistent memory layer for LLMs.** Gives AI models (Claude, Gemini, GPT, Ollama) access to facts, decisions, and context from previous sessions — automatically, without user prompting.

> "Why does your AI forget what you agreed on yesterday?" — MemoryAI solves this by acting as an external, queryable brain for any LLM.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [System Requirements](#system-requirements)
- [Resource Estimates](#resource-estimates)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [MCP Integration](#mcp-integration)
- [REST API Reference](#rest-api-reference)
- [Memory Types](#memory-types)
- [Security](#security)
- [Project Structure](#project-structure)

---

## How It Works

LLMs are **stateless** — every session starts from zero. MemoryAI adds a persistent memory layer:

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
                  │  OpenAI/Anthropic)│
                  └──────────────────┘
```

### Automatic memory flow (zero user effort)

| Step | What happens | Who triggers it |
|------|-------------|-----------------|
| Conversation starts | `memory_get_context` called → top-K relevant memories injected | Model (auto via MCP description) |
| During conversation | `memory_save`, `entity_save` called for important facts | Model (auto judgment) |
| Session ends or 15min idle | Background worker distills full conversation → extracts facts | Server (cron, no user action) |
| Next conversation | Model has full context from previous session | — |

---

## Architecture

### Component Overview

```
memoryai/
├── packages/
│   ├── api/           Node.js + TypeScript + Fastify 5
│   │   ├── src/
│   │   │   ├── config.ts            Env config + validation
│   │   │   ├── index.ts             Server entrypoint
│   │   │   ├── db/pool.ts           PostgreSQL connection pool
│   │   │   ├── middleware/          Auth (API key → user)
│   │   │   ├── routes/              REST endpoints
│   │   │   │   ├── memories.route   CRUD + semantic search
│   │   │   │   ├── sessions.route   Session lifecycle
│   │   │   │   └── entities.route   Entity knowledge base
│   │   │   ├── services/            Business logic
│   │   │   │   ├── memory.service   Create/search/update memories
│   │   │   │   ├── session.service  Session + message management
│   │   │   │   ├── entity.service   Entity upsert/search
│   │   │   │   ├── embedding.service Multi-provider embeddings
│   │   │   │   └── auth.service     API key management
│   │   │   ├── mcp/server.ts        MCP server (HTTP/SSE + JSON-RPC)
│   │   │   └── jobs/
│   │   │       ├── distillation.queue  BullMQ queue definition
│   │   │       └── distillation.worker Auto-extract facts from sessions
│   └── shared/        TypeScript types shared across packages
├── docker/
│   ├── docker-compose.yml   PostgreSQL 16+pgvector, Redis 7, API
│   └── postgres/init.sql    DB schema, indexes, functions
├── scripts/setup.sh         First-time setup (secrets, MCP config)
└── .env.example
```

### Database Schema

```sql
users            -- API keys, multi-user support
projects         -- optional namespacing for memories
sessions         -- conversation tracking
session_messages -- raw message buffer (used for distillation)
memories         -- persistent facts (with vector embeddings)
entities         -- named entities: people, projects, companies
distillation_jobs -- async job tracking
```

### Hybrid Search

Memories are retrieved using a weighted combination of:
- **Vector similarity** (cosine, 70% weight) — semantic relevance via embeddings
- **Full-text search** (BM25/tsvector, 20% weight) — exact keyword matching
- **Importance score** (10% weight) — user-defined or LLM-assigned priority

SQL function `search_memories()` runs all three in a single query for performance.

### MCP Tools

Six tools designed to be used **automatically** by models — tool descriptions are written as instructions:

| Tool | Auto-trigger | Description |
|------|-------------|-------------|
| `memory_get_context` | Start of every conversation | Loads top-K relevant memories |
| `memory_save` | After learning something important | Saves fact/decision/preference |
| `memory_search` | When looking up specific past info | Targeted semantic search |
| `entity_save` | When learning about a person/project | Updates entity knowledge base |
| `entity_get` | When recalling entity info | Retrieves entity facts |
| `session_end` | When user says goodbye | Closes session, queues distillation |

---

## System Requirements

### Minimum (development / light use)

| Component | Minimum |
|-----------|---------|
| CPU | 2 cores |
| RAM | **2 GB** (PostgreSQL 512MB + Redis 256MB + API 256MB) |
| Disk | **5 GB** (DB + indexes + logs) |
| Node.js | **20+** |
| Docker | 24+ with Compose v2 |
| PostgreSQL | 16+ (via `pgvector/pgvector:pg16` image) |
| Redis | 7+ |

### Recommended (production / heavy use)

| Component | Recommended |
|-----------|-------------|
| CPU | 4+ cores |
| RAM | **8 GB** (headroom for large embedding batches + pgvector index in memory) |
| Disk | **50+ GB SSD** (grows with memories; 768-dim vectors ≈ 3KB/memory) |
| Node.js | 20 LTS |

### Ollama (for local embeddings + distillation)

| Model | VRAM / RAM | Notes |
|-------|-----------|-------|
| `nomic-embed-text` (embeddings) | 274 MB | Default, good for EN+PL |
| `bge-m3` (embeddings, multilingual) | 570 MB | Best for Polish content |
| `qwen2.5:7b` (distillation) | 4.7 GB | Recommended for fact extraction |
| `qwen2.5:3b` (distillation, lighter) | 2.0 GB | Works, slightly lower quality |
| `llama3.2:3b` (distillation) | 2.0 GB | Alternative, English-focused |

> **Note:** Ollama models load on demand and are unloaded after idle timeout. Running both embedding and distillation simultaneously requires ~5-6 GB RAM/VRAM for recommended models.

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

> After 1 year of daily use (10 sessions/day × 5 memories/session): **~18,000 memories ≈ ~72 MB**. Entirely manageable.

### CPU / Memory at runtime

| Service | Idle RAM | Peak RAM |
|---------|----------|----------|
| PostgreSQL (pgvector) | ~100 MB | ~512 MB (with active queries) |
| Redis | ~10 MB | ~256 MB (capped by config) |
| MemoryAI API | ~80 MB | ~200 MB |
| Ollama (nomic-embed-text loaded) | ~300 MB | ~500 MB |
| **Total** | **~500 MB** | **~1.5 GB** |

### Network

- Embedding calls to local Ollama: ~10–50ms/request (LAN)
- Distillation (Gemini Flash via API): ~500–2000ms/session
- Distillation (local Ollama qwen2.5:7b): ~5–30s/session (CPU), ~1–5s (GPU)

---

## Quick Start

### 1. Clone and setup

```bash
git clone https://github.com/cenkierpiotr/memoryai
cd memoryai
bash scripts/setup.sh
```

The setup script:
- Generates `.env` with random secrets
- Starts PostgreSQL + Redis via Docker
- Detects installed Ollama models and configures the best one
- Configures MCP in Antigravity (`~/.gemini/antigravity/mcp_config.json`)
- Configures MCP in Claude Code (`~/.claude/settings.json`)

### 2. Start the server

```bash
# With Docker (recommended)
docker compose -f docker/docker-compose.yml up -d

# Or locally (API only, DB must be running)
npm install
npm run dev -w packages/api
```

### 3. Verify

```bash
curl http://localhost:3001/health
# → {"status":"ok","version":"0.1.0","timestamp":"..."}
```

### 4. Restart Antigravity

After setup, restart the IDE to load the new MCP server. The AI models will automatically have access to memory tools.

---

## Configuration

All configuration is via environment variables in `.env`. Run `bash scripts/setup.sh` to generate it with random secrets.

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Secret for JWT signing (min 32 chars) |
| `ADMIN_API_KEY` | Master API key for the first user |
| `POSTGRES_PASSWORD` | PostgreSQL password (for Docker) |
| `REDIS_PASSWORD` | Redis password (for Docker) |

### Embedding provider

```env
# Ollama (default — local, private)
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text  # or bge-m3 for better Polish support
EMBED_DIMENSIONS=768                  # 1024 for bge-m3

# Gemini (Google API)
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_EMBED_MODEL=text-embedding-004

# OpenAI
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your_key_here
OPENAI_EMBED_MODEL=text-embedding-3-small
```

### Distillation LLM (auto-extracts facts from sessions)

```env
# Local Ollama (private, no API cost)
DISTILL_PROVIDER=ollama
DISTILL_MODEL=qwen2.5:7b

# Google Gemini Flash (fast, low cost, good quality)
DISTILL_PROVIDER=gemini
DISTILL_MODEL=gemini-2.0-flash-exp
GEMINI_API_KEY=your_key_here

# Anthropic Claude Haiku (high quality extraction)
DISTILL_PROVIDER=anthropic
DISTILL_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=your_key_here
```

### Distillation schedule

```env
# Trigger after N minutes of session inactivity
DISTILL_INACTIVITY_MINUTES=15

# Or trigger after every N messages
DISTILL_EVERY_N_MESSAGES=50
```

---

## MCP Integration

### Antigravity (automatic via setup.sh)

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

### Claude Code (automatic via setup.sh)

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

### Getting your config snippet via API

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3001/mcp/config
```

Returns ready-to-paste JSON for both Antigravity and Claude Code.

---

## REST API Reference

All endpoints require: `Authorization: Bearer YOUR_API_KEY`

### Memories

```
POST   /v1/memories/search          Semantic search
GET    /v1/memories                 List (with pagination)
POST   /v1/memories                 Create memory
POST   /v1/memories/batch           Bulk create (max 50)
GET    /v1/memories/:id             Get by ID
PATCH  /v1/memories/:id             Update
DELETE /v1/memories/:id             Delete
```

**Search example:**
```bash
curl -X POST http://localhost:3001/v1/memories/search \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "PostgreSQL database decisions", "limit": 5}'
```

**Create memory example:**
```bash
curl -X POST http://localhost:3001/v1/memories \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Decided to use PostgreSQL with pgvector instead of a dedicated vector DB for simplicity",
    "type": "decision",
    "importance": 0.9,
    "tags": ["project:memoryai", "tech:postgresql"]
  }'
```

### Sessions

```
GET    /v1/sessions                 List sessions
POST   /v1/sessions                 Create session
GET    /v1/sessions/:id             Get session
GET    /v1/sessions/:id/messages    Get messages
POST   /v1/sessions/:id/messages    Add message
POST   /v1/sessions/:id/close       Close + trigger distillation
```

### Entities

```
POST   /v1/entities/search          Semantic entity search
GET    /v1/entities                 List entities
POST   /v1/entities                 Create/update entity (upsert by name)
GET    /v1/entities/by-name/:name   Get by name
POST   /v1/entities/:id/facts       Add fact to entity
DELETE /v1/entities/:id             Delete entity
```

**Create entity example:**
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

---

## Memory Types

| Type | When to use | Example |
|------|-------------|---------|
| `fact` | General information | "User uses TypeScript for all new projects" |
| `decision` | A choice that was made | "Decided to use PostgreSQL over MongoDB because of pgvector support" |
| `preference` | What the user likes/dislikes | "User prefers concise responses without trailing summaries" |
| `instruction` | Rule to always follow | "Always write commit messages in English" |
| `entity_relation` | Relationship between things | "cenkier.pl is deployed on LH.pl via FTP" |
| `summary` | Session overview | "Session on 2026-06-01: Designed MemoryAI architecture, chose Fastify+pgvector" |

**Importance scale:**
- `0.9–1.0` — Critical: must-follow instructions, key decisions
- `0.7–0.8` — Important: frequent preferences, project facts
- `0.5–0.6` — Normal: general context
- `0.3–0.4` — Low: minor details

---

## Security

### Authentication

- All REST and MCP endpoints require an **API key** passed as `Authorization: Bearer <key>`
- API keys are stored as bcrypt-safe random 48-character strings (nanoid)
- The admin key is set at startup via `ADMIN_API_KEY` env var

### Data Isolation

- Every query is scoped to `user_id` — users cannot access each other's data
- `session_end` MCP tool verifies session ownership before closing
- `addMessage` verifies session ownership inside the transaction

### SQL Injection Prevention

- All database queries use **parameterized statements** exclusively
- No string interpolation in SQL — Zod validates all inputs before they reach the DB
- Entity `type` and session `status` filters are passed as query parameters, not interpolated

### Input Validation

- All REST endpoints validated with **Zod** schemas before reaching service layer
- MCP tool arguments validated with explicit type checking and enum guards
- String length limits on all text fields (content max 10,000 chars)

### Rate Limiting

- 120 requests/minute per API key (configurable via `RATE_LIMIT_RPM`)
- Redis-backed rate limiting via `@fastify/rate-limit`

### Security Headers

- `@fastify/helmet` adds standard HTTP security headers
- CORS configured with explicit allowed origins (`CORS_ORIGINS` env var)

### What is NOT included (v0.1)

- User registration UI (admin creates users via API)
- OAuth2 login (single-user focused, multi-user via API keys)
- Memory encryption at rest (use disk encryption at infrastructure level)
- Audit logs

---

## Project Structure

```
memoryai/
├── .env.example                    All configuration variables documented
├── docker/
│   ├── docker-compose.yml          PostgreSQL + Redis + API services
│   ├── Dockerfile.api              Multi-stage production build
│   └── postgres/init.sql           Schema, indexes, search functions
├── packages/
│   ├── shared/                     TypeScript types (Memory, Session, Entity, etc.)
│   └── api/
│       └── src/
│           ├── config.ts           Typed env config with startup validation
│           ├── index.ts            Fastify app + graceful shutdown
│           ├── db/pool.ts          PostgreSQL pool + transaction helper
│           ├── middleware/
│           │   └── auth.middleware.ts  API key → User lookup
│           ├── routes/
│           │   ├── memories.route.ts   /v1/memories
│           │   ├── sessions.route.ts   /v1/sessions
│           │   └── entities.route.ts   /v1/entities
│           ├── services/
│           │   ├── memory.service.ts   Core memory CRUD + hybrid search
│           │   ├── session.service.ts  Session lifecycle + message buffer
│           │   ├── entity.service.ts   Entity upsert + vector search
│           │   ├── embedding.service.ts  Multi-provider embedding abstraction
│           │   └── auth.service.ts     API key management
│           ├── mcp/
│           │   └── server.ts       MCP JSON-RPC over HTTP/SSE (6 tools)
│           └── jobs/
│               ├── distillation.queue.ts  BullMQ queue definition
│               └── distillation.worker.ts  Background LLM extraction + scheduler
├── scripts/
│   └── setup.sh                    First-time setup automation
└── README.md
```

---

## Roadmap

- [ ] **React Dashboard** — browse memories, edit, search, analytics
- [ ] **TypeScript SDK** (`@memoryai/client`) — easy integration in any Node.js app  
- [ ] **Python SDK** (`memoryai`) — for Python environments and Jupyter
- [ ] **Proxy middleware** — transparent API proxy that injects memory into any LLM API call (OpenAI-compatible)
- [ ] **Memory consolidation** — periodic deduplication of similar memories
- [ ] **Multi-user management** — admin UI, user registration, per-user settings
- [ ] **Export/import** — backup and restore memories as JSON

---

## License

MIT
