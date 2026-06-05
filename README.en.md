# MemoryAI

**🌐 Language / Język:** [English](README.en.md) · [Polski](README.md)

---

**Persistent memory and agent orchestration layer for LLMs.** Gives AI models (Claude, Gemini, GPT, Ollama) access to facts, decisions, and context from previous sessions — and lets them **autonomously delegate tasks to other AI models** without any API keys.

> "Why does your AI forget everything you agreed on yesterday?" — MemoryAI fixes that and goes further: Claude can automatically send a task to Gemini or a local Ollama model, verify the result, and keep going — with zero user involvement.

![Self-hosted](https://img.shields.io/badge/self--hosted-yes-blue)
![PostgreSQL + pgvector](https://img.shields.io/badge/PostgreSQL-pgvector-4169e1)
![MCP + REST](https://img.shields.io/badge/MCP-REST%20API-green)
![Multi-agent](https://img.shields.io/badge/multi--agent-orchestration-orange)

### At a glance — what MemoryAI does

**🧠 Memory across sessions** — Claude, Gemini, or GPT remember your decisions, preferences, and project context from previous conversations. Zero user configuration — the model calls MCP tools automatically.

**🤖 Agent orchestration without API keys** — the `local-ai` MCP server gives Claude Code direct access to:
- **Gemini** (2.5 Flash ~1s, 3.1 Pro ~4s) via existing Antigravity OAuth session
- **Ollama** (locally on your server) — automatically picks whichever model is loaded in VRAM
- **Claude subagent** — full agentic capabilities with tools (~2-5s)

Claude can autonomously: delegate code review to Gemini, ask Ollama to analyze private data, cross-check answers across multiple models — all in one workflow, no user action required.

**📊 Benchmark (measured times):**
| Agent | Time | Best for |
|-------|------|----------|
| Gemini 2.5 Flash | ~1s | default, quick tasks |
| Ollama/auto (VRAM) | ~1.5s | local/private data |
| Claude subagent | ~2-5s | complex, needs tools |
| Gemini 3.1 Pro | ~4s | deep reasoning |

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Multi-Agent Orchestration](#multi-agent-orchestration)
- [Quick Start](#quick-start)
- [IDE Integration](#ide-integration)
  - [Universal Installer](#universal-installer)
  - [Manual Configuration per IDE](#manual-configuration-per-ide)
- [Open WebUI Integration](#open-webui-integration)
- [MCP Tools Reference](#mcp-tools-reference)
- [REST API Reference](#rest-api-reference)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [System Requirements](#system-requirements)
- [Distillation Details](#distillation-details)
- [Security](#security)
- [Roadmap](#roadmap)
- [License](#license)

---

## Features

### Core

- **Persistent memory for any LLM** — Claude, Gemini, GPT, Ollama, and any model that supports MCP or REST
- **PostgreSQL 16 + pgvector** — production-grade relational storage with first-class vector search via the pgvector extension
- **BullMQ + Redis** — reliable async job queue for background distillation; survives restarts, retries on failure
- **MCP server** (HTTP + SSE, JSON-RPC 2.0) — compatible with Claude Code, Cursor, VS Code, Windsurf, Continue.dev, Claude Desktop, Antigravity
- **REST API** — full CRUD for memories, sessions, entities, and API key management
- **Web dashboard** (in development) — browse memories, search, edit, view distillation job history

### Memory

- **Six memory types**: `fact`, `decision`, `preference`, `instruction`, `entity_relation`, `summary`
- **Importance scale** 0.0–1.0 — assigned by the model or manually; affects retrieval ranking
- **Hybrid search** — 70% semantic (cosine distance via pgvector) + 20% full-text (tsvector BM25) + 10% importance weight, all in a single PostgreSQL query
- **Named entities** — structured knowledge graph entries with typed categories: `person`, `project`, `company`, `system`, `tool`, `server`, `other`
- **Entity facts** — each entity accumulates factual statements across multiple sessions (upsert by name)
- **Pinned memories** — mark memories as pinned to always include them in context regardless of relevance score
- **Memory tags** — arbitrary string labels for filtering and grouping

### Distillation

- **Automatic distillation** triggered after 15 minutes of session inactivity (configurable)
- **Count-based trigger** — also triggers after every N messages if configured
- **LLM-driven extraction** — the distillation model reads the full raw conversation and extracts structured facts, decisions, preferences, instructions, and entity relations
- **Three supported distillation providers**:
  - **Ollama** — fully local and private, no API key, works offline
  - **Gemini** (via API key) — fast, low cost per session
  - **Anthropic** (via API key) — highest structured output quality
- **BullMQ worker** runs every minute and processes stale sessions from the Redis queue
- **Temporal consolidation** (weekly) — merges similar memories to prevent redundancy
- **Deduplication** (weekly) — removes exact and near-duplicate memories automatically

### Multi-Agent Orchestration

- **`local-ai` MCP server** (`integrations/claude-code/mcp-local-ai.py`) — gives Claude Code and other AI agents direct access to multiple models simultaneously
- **`ask_gemini`** — queries Gemini via Antigravity's OAuth session, no API key needed
- **`ask_model`** — queries any model available in the connected Antigravity language server
- **`ask_ollama`** — queries local Ollama models on any configured server
- **`list_ai_models`** — lists all Gemini/Claude/GPT models available through Antigravity
- **`list_ollama_models`** — lists all locally available Ollama models
- **Zero-config CSRF discovery** — the MCP server reads `/proc` at runtime to find the Antigravity language server port and CSRF token; no hardcoded values, survives every restart automatically
- **`ask-model.py` CLI tool** — call any model directly from the terminal, with stdin support and JSON output mode

### IDE Integrations

- Cursor, VS Code, Windsurf, Continue.dev, Claude Desktop, Antigravity, Claude Code (CLI)
- **Universal Python installer** — auto-detects all installed IDEs and writes MCP config for each; works on Linux, macOS, Windows with no dependencies beyond Python 3
- Served by MemoryAI itself under `/dashboard/install.py` — always up to date

### Open WebUI Integration

- **`memoryai_filter.py`** — global filter that auto-injects relevant memories into every conversation's system prompt; no model awareness required
- **`memoryai_tools.py`** — explicit tools the model can call on demand: `memory_search`, `memory_save`, `entity_get`, `entity_save`, `memory_get_context`
- Zero-config for end users: the filter runs automatically on every message

### Remote Access

- **Tailscale Serve** — expose MemoryAI to your tailnet only
- **Tailscale Funnel** — public HTTPS endpoint without any certificate management

### Security

- Bearer token authentication on every REST and MCP endpoint
- Rate limiting per API key via `@fastify/rate-limit` (default 10,000 RPM, configurable)
- `@fastify/helmet` security headers (CSP, HSTS, X-Frame-Options, etc.)
- CORS restricted to explicit allowed origins
- Parameterized SQL queries throughout — no string interpolation, no SQL injection surface
- Zod input validation on all REST endpoints and MCP tool arguments
- All database queries scoped to `user_id` — complete data isolation between users
- AES-256-GCM encryption available for credential-category memories (`ENCRYPTION_KEY`)

---

## How It Works

LLMs are **stateless** — every session starts from zero. MemoryAI adds a persistent memory layer between your IDE/agent and the model:

```
┌──────────────────────────────────────────────────────────────┐
│        YOUR IDE / AGENT  (Claude Code, Cursor, Open WebUI)   │
│  Model sees MCP tools → calls them automatically             │
└─────────────────────────┬────────────────────────────────────┘
                          │  MCP (HTTP/SSE, JSON-RPC 2.0)
                          │  or REST API
┌─────────────────────────▼────────────────────────────────────┐
│              MemoryAI Server  (Node.js 20 + Fastify 5)       │
│                                                              │
│  ① session start    →  memory_get_context()                  │
│     returns top-K relevant memories → injected into context  │
│                                                              │
│  ② during session   →  memory_save() / entity_save()         │
│     model persists facts, decisions, preferences             │
│                                                              │
│  ③ session ends     →  session_end()                         │
│     queues background distillation of full conversation      │
└────────┬────────────────────────┬────────────────────────────┘
         │                        │
┌────────▼──────────┐   ┌─────────▼──────────────┐
│   PostgreSQL 16   │   │   Redis 7               │
│   + pgvector 0.7  │   │   BullMQ job queue      │
│                   │   │   session state cache   │
│   memories        │   └─────────────────────────┘
│   sessions        │             │
│   entities        │   ┌─────────▼──────────────┐
│   users           │   │   Distillation Worker   │
│   projects        │   │   (BullMQ, every 1 min) │
└───────────────────┘   │                        │
                        │   ┌────────────────┐   │
                        │   │  Distill LLM   │   │
                        │   │  Ollama        │   │
                        │   │  Gemini Flash  │   │
                        │   │  Claude Haiku  │   │
                        │   └────────────────┘   │
                        └────────────────────────┘
```

### Automatic memory flow — zero user effort

| Step | What happens | Who triggers it |
|------|-------------|-----------------|
| Conversation starts | `memory_get_context` called → top-K relevant memories injected into context | Model (auto via MCP tool description) |
| During conversation | `memory_save`, `entity_save` called when important facts appear | Model (autonomous judgment) |
| Session idle 15 min | Inactivity timer fires → session queued for distillation | Server (automatic, no user action) |
| Worker picks up job | LLM reads full session → extracts structured memories + entities | BullMQ worker (background) |
| Next conversation | Model has full context from previous sessions automatically | — |

### Hybrid search

Memories are retrieved using a weighted combination of three signals, all computed in a single PostgreSQL query with no extra round trips:

| Signal | Weight | Method |
|--------|--------|--------|
| Semantic similarity | 70% | Cosine distance via pgvector (`<=>` operator) |
| Full-text match | 20% | BM25 ranking via `tsvector` + `to_tsquery` |
| Importance score | 10% | User-defined or LLM-assigned (0.0–1.0) |

The hybrid score means that a high-importance memory will surface even when it is not the closest semantic match — useful for pinned instructions and critical decisions.

---

## Multi-Agent Orchestration

This is one of the most distinctive features of MemoryAI: not just memory, but **active multi-model orchestration**. Claude Code (or any agent) can delegate subtasks to Gemini, cross-check answers with a different model, or use a local Ollama model for privacy-sensitive reasoning — all within the same conversation, with no API keys.

### The `local-ai` MCP Server

Located at `integrations/claude-code/mcp-local-ai.py`, this is a **stdio MCP server** that exposes five tools:

| Tool | What it does |
|------|-------------|
| `ask_gemini` | Sends a prompt to Gemini (default: `gemini-2.5-flash`). Uses Antigravity OAuth — no API key needed. |
| `ask_model` | Sends a prompt to any model connected to the Antigravity language server (Gemini, Claude, GPT). |
| `ask_ollama` | Sends a prompt to a local Ollama model on the configured server. |
| `list_ai_models` | Returns all Gemini/Claude/GPT models available through Antigravity. |
| `list_ollama_models` | Returns all Ollama models available on the local Ollama server. |

### How the CSRF Token Discovery Works

Antigravity (the VS Code / Windsurf fork by Codeium) runs a local language server process — `language_server_linux_x64` — that is already authenticated with Google OAuth. This language server exposes a ConnectRPC API on a local HTTPS port.

The `local-ai` MCP server discovers both the port and the CSRF token **at runtime** by parsing `/proc` output (via `ps aux`):

```
Step 1: ps aux | grep language_server_linux_x64
Step 2: extract --csrf_token <uuid> from the process args
Step 3: probe known ports [44751, 43951, 43337, 43205] with a Heartbeat call
Step 4: cache (csrf, port) for the duration of the MCP session
Step 5: on any failure, re-discover automatically
```

This means:
- No hardcoded ports or tokens in any config file
- Survives Antigravity restarts (token and port change on each restart, but are re-discovered on next call)
- Works even if the port changes between machines

### Call Flow Diagram

```
Claude Code CLI
  │
  ├─ reads user message, decides to ask Gemini
  │
  └─► MCP tool call: mcp__local-ai__ask_gemini
        │  prompt="Review this PR diff for security issues"
        │  model="gemini-3.1-pro-high"
        │
        └─► mcp-local-ai.py (stdio MCP server)
              │
              ├─► ps aux → find language_server_linux_x64
              ├─► extract csrf_token
              ├─► probe port 44751 → Heartbeat OK
              │
              └─► ConnectRPC POST to 127.0.0.1:44751
                    path: /exa.language_server_pb.LanguageServerService/GetModelResponse
                    headers:
                      x-codeium-csrf-token: <uuid>
                      Content-Type: application/json
                      Connect-Protocol-Version: 1
                    body: {"prompt": "...", "model": "MODEL_PLACEHOLDER_M37"}
                    │
                    └─► Antigravity language server
                          │
                          └─► Google Cloud AI (via existing OAuth)
                                │
                                └─► response streamed back to Claude Code
```

```
Claude Code CLI
  │
  └─► MCP tool call: mcp__local-ai__ask_ollama
        │  prompt="Explain this algorithm step by step"
        │  model="qwen2.5:14b"
        │
        └─► mcp-local-ai.py
              │
              └─► HTTP POST to http://100.99.158.2:11434/api/generate
                    body: {"model": "qwen2.5:14b", "prompt": "...", "stream": false}
                    │
                    └─► Ollama (local, Dell server)
                          └─► inference runs locally, no internet required
                                └─► response returned to Claude Code
```

### Installation

Add the `local-ai` MCP server to your project's `.mcp.json` file (or to your global `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "local-ai": {
      "type": "stdio",
      "command": "python3",
      "args": ["/path/to/memoryai/integrations/claude-code/mcp-local-ai.py"]
    }
  }
}
```

After reloading your IDE or restarting Claude Code, the following tools become available:

```
mcp__local-ai__ask_gemini          Ask Gemini via OAuth (no API key)
mcp__local-ai__ask_model           Ask any Antigravity-connected model
mcp__local-ai__ask_ollama          Ask a local Ollama model
mcp__local-ai__list_ai_models      List available Gemini/Claude/GPT models
mcp__local-ai__list_ollama_models  List available local Ollama models
```

**Requirements:**
- Antigravity (VS Code / Windsurf with Codeium extension) must be running and authenticated
- For `ask_ollama`: Ollama must be running at the configured `OLLAMA_URL`
- Python 3.8+ (no external packages needed — uses only stdlib)

### Available Models via local-ai

#### Cloud models (via Antigravity OAuth — no API key)

| Alias | Description | Best for |
|-------|-------------|----------|
| `gemini-2.5-flash` | Default — fast and free | General queries, quick analysis |
| `gemini-2.5-flash-lite` | Lighter variant | Ultra-fast, minimal tasks |
| `gemini-2.5-flash-thinking` | Reasoning mode | Multi-step problems, math |
| `gemini-2.5-pro` | Pro tier | Deep analysis (may have capacity limits) |
| `gemini-3.1-flash-lite` | Next gen light | Fast queries |
| `gemini-3.1-pro-low` | Next gen Pro, economy | Solid general intelligence |
| `gemini-3.1-pro-high` | Next gen Pro, full | Best overall quality |
| `gemini-3.5-flash-medium` | Flash series | Balanced speed/quality |
| `gemini-3.5-flash-high` | Flash series, high | Higher quality, still fast |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | Code, reasoning, writing |
| `claude-opus-4-6-thinking` | Claude Opus with thinking | Complex reasoning, architecture |
| `gpt-oss-120b` | GPT OSS 120B | Alternative perspective |

#### Local models via Ollama

| Model | RAM needed | Best for |
|-------|-----------|----------|
| `qwen3.5:4b` | 3 GB | Default fast model, everyday tasks |
| `qwen2.5:7b` | 4.7 GB | General reasoning, good for Polish |
| `qwen2.5:14b` | 9 GB | High-quality local inference |
| `llama3.1:8b` | 5 GB | General purpose, English |
| `deepseek-coder-v2:16b` | 10 GB | Code generation and review |
| `codestral:22b` | 14 GB | Advanced code tasks |
| `mistral:latest` | 4.1 GB | European model, multilingual |
| `mistral-nemo:latest` | 7 GB | Better reasoning than base Mistral |
| `llama3.2-vision:11b` | 8 GB | Vision and image tasks |

### Model Selection Guide

| Task | Recommended model | Reason |
|------|------------------|--------|
| General analysis and knowledge | `gemini-2.5-flash` | Fast, free, very capable |
| Deep reasoning / architecture | `gemini-3.1-pro-high` | Best quality available via OAuth |
| Complex multi-step problems | `gemini-2.5-flash-thinking` or `claude-opus-4-6-thinking` | Reasoning mode enabled |
| Code review | `gemini-3.1-pro-high` or `deepseek-coder-v2:16b` (Ollama) | Strong code understanding |
| Code generation | `deepseek-coder-v2:16b` or `codestral:22b` | Specialized code models |
| Privacy-sensitive tasks | Any Ollama model | Never leaves your machine |
| Fast local inference | `qwen3.5:4b` | 3 GB RAM, sub-second on GPU |
| Polish/multilingual content | `qwen2.5:14b` or `bge-m3` | Trained on multilingual data |
| Second opinion / cross-check | Different model from the first | Different training → different errors |
| Vision / multimodal | `llama3.2-vision:11b` or `qwen2.5vl:7b` | Can process images |

### Example Workflows

#### Workflow 1: Claude delegates PR security review to Gemini

```
User: "Review the security of this PR"

Claude:
  1. Reads the PR diff (via gh CLI or file read tools)
  2. Calls mcp__local-ai__ask_gemini with:
       prompt = "Security review of this diff: [diff content]"
       model = "gemini-3.1-pro-high"
       system = "You are a senior security engineer. Find injection, auth bypass, and data exposure issues."
  3. Receives Gemini's security analysis
  4. Synthesizes findings with its own analysis
  5. Calls mcp__memoryai__memory_save with the key findings as a 'decision' type memory
  6. Returns combined report to user
```

#### Workflow 2: Claude uses Ollama for private code analysis

```
User: "Analyze the algorithm in this file — keep it private"

Claude:
  1. Reads the file content
  2. Calls mcp__local-ai__ask_ollama with:
       prompt = "Analyze time/space complexity and suggest optimizations: [code]"
       model = "qwen2.5:14b"
       system = "You are an algorithms expert."
  3. Analysis runs 100% locally on the Dell server — never sent to any cloud
  4. Returns analysis to user
```

#### Workflow 3: Claude orchestrates multi-model consensus

```
User: "What database should I use for this project?"

Claude:
  1. Calls mcp__local-ai__ask_gemini — gets Gemini's recommendation
  2. Calls mcp__local-ai__ask_model with model="claude-sonnet-4-6" — gets another Claude's view
  3. Compares the two responses for agreement/disagreement
  4. Synthesizes a recommendation
  5. Saves the decision to MemoryAI:
       mcp__memoryai__memory_save({
         content: "Decided to use PostgreSQL — recommended by both Gemini and Claude",
         type: "decision",
         importance: 0.9
       })
```

### CLI Tool: `ask-model.py`

For quick model calls from the terminal without needing an IDE:

```bash
# Basic usage — asks Gemini 2.5 Flash (default)
python3 integrations/claude-code/ask-model.py "Explain this regex: ^[a-z]{3,}$"

# Specify a different model
python3 integrations/claude-code/ask-model.py "Review this function" --model gemini-3.1-pro-high

# Add a system prompt for specialized behavior
python3 integrations/claude-code/ask-model.py \
  "Review this diff for security issues" \
  --model gemini-3.1-pro-high \
  --system "You are a senior security engineer focused on OWASP Top 10"

# Read prompt from stdin (useful in pipelines)
git diff HEAD~1 | python3 integrations/claude-code/ask-model.py --model gemini-2.5-flash

# List all available models
python3 integrations/claude-code/ask-model.py --list-models

# Output as JSON (for scripting)
python3 integrations/claude-code/ask-model.py "Summarize this" --json

# Set custom timeout for slow models
python3 integrations/claude-code/ask-model.py "Complex question" \
  --model claude-opus-4-6-thinking \
  --timeout 120
```

**All CLI flags:**

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--model` | `-m` | `gemini-2.5-flash` | Model alias to use |
| `--system` | `-s` | — | System prompt |
| `--list-models` | `-l` | — | List all available models and exit |
| `--timeout` | `-t` | `30` | Timeout in seconds |
| `--json` | — | — | Output `{"model": "...", "response": "..."}` as JSON |

---

## Quick Start

### 1. Clone and run setup

```bash
git clone https://github.com/cenkierpiotr/memoryai
cd memoryai
bash scripts/setup.sh
```

The `setup.sh` script performs the following automatically:

- Generates `.env` with cryptographically random secrets (via `openssl rand`)
- Starts PostgreSQL 16 + pgvector and Redis 7 via Docker Compose
- Runs database migrations and creates all tables, indexes, and search functions
- Detects installed Ollama models and configures the best available one for embeddings and distillation
- Writes MCP configuration to Antigravity (`~/.gemini/antigravity/mcp_config.json`) if installed
- Writes MCP configuration to Claude Code (`~/.claude/settings.json`) if installed

### 2. Start the server

```bash
# Recommended: Docker Compose — includes PostgreSQL and Redis
docker compose -f docker/docker-compose.yml up -d

# Local development (PostgreSQL and Redis must be running separately)
npm install
npm run dev -w packages/api
```

### 3. Verify the server is running

```bash
curl http://localhost:3001/health
# Expected: {"status":"ok","version":"0.1.0","timestamp":"2026-06-04T..."}
```

### 4. Connect your IDE

The fastest way is the universal installer (see [IDE Integration](#ide-integration)):

```bash
# Linux / macOS — auto-detects all installed IDEs
curl -sL http://localhost:3001/dashboard/install.py | python3

# Or add manually to ~/.claude/settings.json (Claude Code)
```

After reloading your IDE, the AI model automatically has access to all six memory tools and will start building persistent memory from the first conversation.

### 5. Test the memory tools

Ask your AI:

```
"Remember that I prefer TypeScript strict mode in all projects."
```

Then start a new conversation and ask:

```
"What are my coding preferences?"
```

The model will retrieve the previously saved preference via `memory_get_context` automatically.

---

## IDE Integration

### Universal Installer

A single Python script auto-detects all installed IDEs and writes the correct MCP configuration for each. It works on Linux, macOS, and Windows without any dependencies beyond Python 3.

**Linux / macOS:**
```bash
curl -sL http://localhost:3001/dashboard/install.py | python3
```

**Windows (PowerShell):**
```powershell
python3 -c "import urllib.request; exec(urllib.request.urlopen('http://localhost:3001/dashboard/install.py').read())"
```

Replace `localhost:3001` with your MemoryAI host (e.g. your Tailscale Funnel URL for remote access).

**Installer flags:**

| Flag | Description |
|------|-------------|
| `--force` | Overwrite existing MemoryAI MCP entries without prompting |
| `--check` | Dry-run — detect IDEs and show what would be written, without making changes |
| `--list` | Detect installed IDEs, print their config paths, and exit |

**Example with flags:**
```bash
# Check what the installer would do, without writing anything
curl -sL http://localhost:3001/dashboard/install.py | python3 -- --check

# Force-overwrite all existing configs
curl -sL http://localhost:3001/dashboard/install.py | python3 -- --force
```

The installer reads your API key from the MemoryAI server and writes it (in the `Authorization: Bearer` header) to each detected IDE's config file. Config paths are platform-aware:

| IDE | Linux | macOS | Windows |
|-----|-------|-------|---------|
| Cursor | `~/.cursor/mcp.json` | `~/.cursor/mcp.json` | `%USERPROFILE%\.cursor\mcp.json` |
| VS Code | `~/.config/Code/User/mcp.json` | `~/Library/Application Support/Code/User/mcp.json` | `%APPDATA%\Code\User\mcp.json` |
| Windsurf | `~/.windsurf/mcp.json` | `~/.windsurf/mcp.json` | `%USERPROFILE%\.windsurf\mcp.json` |
| Continue.dev | `~/.continue/config.json` | `~/.continue/config.json` | `%USERPROFILE%\.continue\config.json` |
| Claude Desktop | `~/.config/Claude/claude_desktop_config.json` | `~/Library/Application Support/Claude/claude_desktop_config.json` | `%APPDATA%\Claude\claude_desktop_config.json` |
| Antigravity | `~/.gemini/antigravity/mcp_config.json` | `~/.gemini/antigravity/mcp_config.json` | — |
| Claude Code (CLI) | `~/.claude/settings.json` | `~/.claude/settings.json` | `%USERPROFILE%\.claude\settings.json` |

---

### Manual Configuration per IDE

All manual configs require your API key. Retrieve it from `.env` (`ADMIN_API_KEY`) or generate a new one via the REST API.

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

Add to the `mcpServers` array in `~/.continue/config.json`:
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

#### Antigravity (Google Codeium)

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

Note: Antigravity uses the SSE endpoint (`/mcp/sse`) rather than the standard HTTP endpoint.

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

#### Get ready-to-paste config snippets via API

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3001/mcp/config
```

Returns a JSON object with ready-to-paste config snippets for all supported IDEs.

---

### Remote Access via Tailscale

MemoryAI can be exposed securely over HTTPS using Tailscale Funnel, making it accessible from any machine — home, work laptop, mobile, or remote agent — without a VPN client.

```bash
# Expose only to your Tailnet (private)
tailscale serve --bg 3001

# Make it publicly accessible via HTTPS (Tailscale Funnel)
tailscale funnel --bg 3001
```

After running these commands, your MemoryAI server is available at:

```
https://your-device.tailfbeb53.ts.net/mcp
```

Use this URL instead of `http://localhost:3001/mcp` in all IDE configurations. TLS is terminated by Tailscale infrastructure — no certificate management needed.

Use cases:
- Shared memory server accessed from multiple machines
- Access your memories from a mobile device or remote agent
- Run MemoryAI on a home server and use it from your laptop anywhere

**Security note:** Tailscale Funnel makes the endpoint publicly routable. MemoryAI requires a valid Bearer API key on every request, so unauthorized access is blocked at the application layer. Rotate your `ADMIN_API_KEY` if you suspect compromise.

---

## Open WebUI Integration

MemoryAI integrates with [Open WebUI](https://github.com/open-webui/open-webui) via two Python components located in the `openwebui/` directory. These require no changes to the AI model configuration — memory injection is fully transparent.

| File | Role |
|------|------|
| `memoryai_filter.py` | Global Filter — automatically injects relevant memories into every conversation's system prompt |
| `memoryai_tools.py` | Tools — lets the model explicitly search and save memories on demand |

### Filter: `memoryai_filter.py`

The filter runs on every message — before (`inlet`) and after (`outlet`) the model responds.

**On every user message (`inlet`):**
1. Searches MemoryAI for memories semantically relevant to the user's message
2. Also retrieves related named entities (people, projects, tools, systems)
3. Builds a `[MEMORYAI CONTEXT]` block and injects it into the system prompt
4. Saves the user message to a MemoryAI session for later distillation

**After every AI response (`outlet`):**
1. Saves the assistant response to the same MemoryAI session
2. Session messages accumulate and are distilled to long-term memories after inactivity

This means the model always has relevant past context without the user needing to say "remember" or "look up". Distillation converts the full conversation into structured facts automatically.

### Tools: `memoryai_tools.py`

Five explicit tools the model can call when it needs more control:

| Tool | Description |
|------|-------------|
| `memory_search` | Semantic search across all stored memories |
| `memory_save` | Save a new memory with type and importance |
| `entity_get` | Retrieve all facts for a named entity |
| `entity_save` | Create or update a named entity |
| `memory_get_context` | Get top-K most relevant memories for current context |

### Installation

```bash
# Copy integration files into the Open WebUI container
docker cp openwebui/memoryai_filter.py openwebui:/app/backend/data/memoryai_filter.py
docker cp openwebui/memoryai_tools.py  openwebui:/app/backend/data/memoryai_tools.py
```

Then in the Open WebUI admin panel:
- **Admin → Functions → Add Filter** → paste contents of `memoryai_filter.py`
- **Admin → Tools → Add Tool** → paste contents of `memoryai_tools.py`

### Filter Valves (configuration)

These settings are configurable per-user in the Open WebUI interface under the filter's settings:

| Valve | Default | Description |
|-------|---------|-------------|
| `memoryai_url` | `http://localhost:3010` | MemoryAI API base URL |
| `memoryai_token` | — | Bearer token (copy from `ADMIN_API_KEY`) |
| `max_memories` | `6` | Maximum memories injected per request |
| `min_score` | `0.45` | Minimum relevance score threshold (0.0–1.0) |
| `inject_entities` | `true` | Also inject related entity facts |
| `max_entities` | `3` | Maximum entity facts blocks to inject |
| `save_to_session` | `true` | Save messages for background distillation |

---

## MCP Tools Reference

Six tools are exposed via the MCP server. Tool descriptions are written as behavioral instructions so models call them automatically — no explicit user prompting required. The model's system prompt tells it to use these tools at session start, when learning new facts, and at session end.

### `memory_get_context`

**Auto-trigger:** Start of every conversation.

Loads the top-K memories most relevant to the current session context. Returns a formatted block injected directly into the model's context window. This is the primary tool for retrieving past context.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Short description of the current session's topic or goal |
| `limit` | integer | no | Maximum memories to return (default: 10, max: 20) |
| `session_id` | string | no | If provided, reuses an existing session instead of creating a new one |

**Example:**
```json
{
  "query": "current project and user preferences for TypeScript development",
  "limit": 10
}
```

**Returns:** Array of memories with `content`, `type`, `importance`, `tags`, and a `session_id` for use in subsequent calls.

---

### `memory_save`

**Auto-trigger:** After the model encounters something worth persisting.

Saves a single memory. The model calls this autonomously when it detects facts, decisions, preferences, or instructions that should survive beyond the current session. It does not wait for the user to say "remember this."

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | yes | The fact or statement to save (max 10,000 characters) |
| `type` | string | yes | Memory type: `fact`, `decision`, `preference`, `instruction`, `entity_relation`, `summary` |
| `importance` | number | no | Importance score 0.0–1.0 (default: 0.5) |
| `tags` | array | no | String labels for filtering (e.g. `["project:memoryai", "tech:typescript"]`) |
| `session_id` | string | no | Associate this memory with a specific session |

**Example:**
```json
{
  "content": "User prefers TypeScript strict mode in all new projects — enforced at tsconfig level",
  "type": "preference",
  "importance": 0.8,
  "tags": ["typescript", "coding-style", "project-setup"],
  "session_id": "sess_abc123"
}
```

---

### `memory_search`

**Auto-trigger:** When the model needs to look up specific past information.

Targeted hybrid semantic search across all stored memories. More focused and controllable than `memory_get_context`. Useful when the model needs to answer a specific question about past decisions or preferences.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query — natural language description of what to find |
| `limit` | integer | no | Maximum results to return (default: 5, max: 20) |
| `type` | string | no | Filter by memory type: `fact`, `decision`, `preference`, `instruction`, `entity_relation`, `summary` |
| `min_importance` | number | no | Only return memories with importance >= this value |

**Example:**
```json
{
  "query": "database architecture decisions for the cenkier project",
  "limit": 5,
  "type": "decision"
}
```

**Returns:** Array of memories sorted by hybrid relevance score descending.

---

### `entity_save`

**Auto-trigger:** When the model learns about a person, project, company, or system.

Creates or updates a named entity in the knowledge graph (upsert by name). Entities accumulate facts across sessions — calling `entity_save` for an existing entity name adds the new facts to it without replacing existing ones.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Entity name — used as the unique identifier (case-insensitive) |
| `type` | string | yes | Entity type: `person`, `project`, `company`, `system`, `tool`, `server`, `other` |
| `facts` | array | no | Array of fact strings to associate with this entity |

**Example:**
```json
{
  "name": "Dell home server",
  "type": "server",
  "facts": [
    "Tailscale IP: 100.99.158.2",
    "Runs Docker, Ollama, n8n, and MemoryAI",
    "Primary deployment target for all self-hosted projects",
    "24 GB RAM, AMD Ryzen 5 5600G"
  ]
}
```

Entity types:

| Type | Used for |
|------|---------|
| `person` | Team members, clients, contacts |
| `project` | Software projects, products |
| `company` | Organizations, clients |
| `system` | Servers, infrastructure, services |
| `tool` | Software tools, libraries, frameworks |
| `server` | Specific server instances |
| `other` | Anything that does not fit above |

---

### `entity_get`

**Auto-trigger:** When the model needs to recall information about a known entity.

Retrieves the full entity record including all stored facts. Faster and more precise than a semantic search when you know the entity name.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Entity name to look up (case-insensitive) |

**Example:**
```json
{
  "name": "Dell home server"
}
```

**Returns:** Entity object with `name`, `type`, `facts` array, `createdAt`, `updatedAt`.

---

### `session_end`

**Auto-trigger:** When the user signals end of work, says goodbye, or closes the conversation.

Closes the current session and queues it for background distillation. Also called automatically by the server's inactivity timer after `DISTILL_INACTIVITY_MINUTES` of no new messages.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | The session ID to close (obtained from `memory_get_context`) |
| `summary` | string | no | Optional brief summary of what was accomplished in this session |

**Example:**
```json
{
  "session_id": "sess_abc123",
  "summary": "Designed the distillation worker architecture, decided on BullMQ over native pg queue"
}
```

**What happens after this call:**
1. Session status set to `closed`
2. BullMQ job enqueued: `distill-{sessionId}`
3. Worker picks up within 1 minute
4. LLM reads all `session_messages` and extracts structured facts
5. Extracted facts saved as `memories` and `entities`
6. Session status set to `distilled`

---

## REST API Reference

All endpoints require: `Authorization: Bearer YOUR_API_KEY`

Base URL: `http://localhost:3001` (or your remote URL)

### Memories

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/memories/search` | Hybrid semantic + full-text + importance search |
| `GET` | `/v1/memories` | List all memories (paginated, filterable by type/tags) |
| `POST` | `/v1/memories` | Create a single memory |
| `POST` | `/v1/memories/batch` | Bulk create up to 50 memories in one request |
| `GET` | `/v1/memories/:id` | Get memory by ID |
| `PATCH` | `/v1/memories/:id` | Update memory content, type, importance, or tags |
| `DELETE` | `/v1/memories/:id` | Delete memory permanently |

**Search example:**
```bash
curl -X POST http://localhost:3001/v1/memories/search \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "PostgreSQL database decisions",
    "limit": 5,
    "type": "decision",
    "min_importance": 0.6
  }'
```

**Create example:**
```bash
curl -X POST http://localhost:3001/v1/memories \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Decided to use PostgreSQL with pgvector instead of a dedicated vector DB — pgvector is sufficient for < 1M vectors and avoids operational complexity",
    "type": "decision",
    "importance": 0.9,
    "tags": ["project:memoryai", "tech:postgresql", "tech:pgvector"]
  }'
```

**Batch create example:**
```bash
curl -X POST http://localhost:3001/v1/memories/batch \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "memories": [
      {
        "content": "User uses pnpm as the package manager for all Node.js projects",
        "type": "preference",
        "importance": 0.6,
        "tags": ["nodejs", "tooling"]
      },
      {
        "content": "Node.js 20 LTS is the standard version on all servers",
        "type": "fact",
        "importance": 0.7,
        "tags": ["nodejs", "infrastructure"]
      },
      {
        "content": "Always write commit messages in English, even in Polish-language projects",
        "type": "instruction",
        "importance": 0.9,
        "tags": ["git", "conventions"]
      }
    ]
  }'
```

**List with pagination:**
```bash
curl "http://localhost:3001/v1/memories?page=1&limit=20&type=decision" \
  -H "Authorization: Bearer YOUR_KEY"
```

---

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/sessions` | List sessions (paginated, filterable by status) |
| `POST` | `/v1/sessions` | Create a new session |
| `GET` | `/v1/sessions/:id` | Get session details and status |
| `GET` | `/v1/sessions/:id/messages` | Get full message history for a session |
| `POST` | `/v1/sessions/:id/messages` | Add a message to a session |
| `POST` | `/v1/sessions/:id/close` | Close session and trigger distillation |

Session statuses: `open` → `closed` → `distilling` → `distilled`

**Create session:**
```bash
curl -X POST http://localhost:3001/v1/sessions \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"context": "Working on MemoryAI dashboard feature — React + Vite"}'
```

**Add message to session:**
```bash
curl -X POST http://localhost:3001/v1/sessions/SESSION_ID/messages \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"role": "user", "content": "Let us use React Query for data fetching"}'
```

**Close and trigger distillation:**
```bash
curl -X POST http://localhost:3001/v1/sessions/SESSION_ID/close \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"summary": "Decided on React + Vite + React Query for dashboard"}'
```

---

### Entities

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/entities/search` | Semantic search across entities |
| `GET` | `/v1/entities` | List all entities |
| `POST` | `/v1/entities` | Create or update entity (upsert by name) |
| `GET` | `/v1/entities/by-name/:name` | Get entity by name (URL-encoded) |
| `POST` | `/v1/entities/:id/facts` | Add one or more facts to an existing entity |
| `DELETE` | `/v1/entities/:id` | Delete entity and all its facts |

**Create entity:**
```bash
curl -X POST http://localhost:3001/v1/entities \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Dell home server",
    "type": "server",
    "facts": [
      {"content": "Tailscale IP: 100.99.158.2"},
      {"content": "Runs Docker, Ollama, n8n, MemoryAI, Postgres"},
      {"content": "Primary deployment target for self-hosted projects"},
      {"content": "24 GB RAM, AMD Ryzen 5 5600G, Ubuntu 22.04"}
    ]
  }'
```

**Get entity by name:**
```bash
curl "http://localhost:3001/v1/entities/by-name/Dell%20home%20server" \
  -H "Authorization: Bearer YOUR_KEY"
```

**Add fact to existing entity:**
```bash
curl -X POST http://localhost:3001/v1/entities/ENTITY_ID/facts \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "Upgraded to 48 GB RAM in June 2026"}'
```

---

### System

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns status, version, timestamp |
| `GET` | `/mcp/config` | Get ready-to-paste MCP config snippets for all IDEs |

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and fill in values, or run `bash scripts/setup.sh` to generate everything automatically.

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `localhost` | PostgreSQL hostname |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `memoryai` | Database name |
| `POSTGRES_USER` | `memoryai` | Database user |
| `POSTGRES_PASSWORD` | — | **Required.** PostgreSQL password |
| `DATABASE_URL` | — | Full connection string (overrides individual vars) |

### Redis

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | — | **Required.** Redis password |
| `REDIS_URL` | — | Full connection string (overrides individual vars) |

### API Server

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node environment |
| `API_PORT` | `3001` | Port to listen on |
| `API_HOST` | `0.0.0.0` | Bind address |
| `JWT_SECRET` | — | **Required.** JWT signing secret, minimum 32 characters |
| `ADMIN_API_KEY` | — | **Required.** Initial admin API key |
| `CORS_ORIGINS` | `*` | Comma-separated allowed CORS origins |
| `MCP_SERVER_URL` | `http://localhost:3001/mcp` | Public URL used in generated IDE configs |

### Embedding Provider

Choose one of three providers for converting text to vectors:

```env
# Option 1: Ollama (default — local, private, no API cost)
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text    # 768 dimensions
EMBED_DIMENSIONS=768

# For better multilingual / Polish support:
# OLLAMA_EMBED_MODEL=bge-m3
# EMBED_DIMENSIONS=1024

# Option 2: Google Gemini
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_EMBED_MODEL=text-embedding-004

# Option 3: OpenAI
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your_key_here
OPENAI_EMBED_MODEL=text-embedding-3-small
```

**Note:** `EMBED_DIMENSIONS` must match the model. Changing this setting after data has been written requires re-embedding all existing memories (run `scripts/reembed.sh`).

### Distillation LLM

The distillation LLM reads raw session messages and extracts structured facts. It runs in the background after sessions close and never blocks the API.

```env
# Option 1: Local Ollama (private, no API cost)
DISTILL_PROVIDER=ollama
DISTILL_MODEL=qwen2.5:7b               # recommended
# DISTILL_MODEL=qwen2.5:3b            # lighter, slightly lower quality

# Option 2: Google Gemini Flash (fast, low cost)
DISTILL_PROVIDER=gemini
DISTILL_MODEL=gemini-2.0-flash-exp
GEMINI_API_KEY=your_key_here

# Option 3: Anthropic Claude Haiku (highest structured output quality)
DISTILL_PROVIDER=anthropic
DISTILL_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=your_key_here
```

### Distillation Schedule

```env
# Trigger distillation after N minutes of session inactivity (default: 15)
DISTILL_INACTIVITY_MINUTES=15

# Also trigger after every N messages regardless of inactivity (0 = disabled)
DISTILL_EVERY_N_MESSAGES=50
```

### Security and Rate Limiting

```env
# Maximum search results returned per query
SEARCH_MAX_RESULTS=20

# Maximum requests per minute per API key (default: 10000)
RATE_LIMIT_RPM=10000

# AES-256-GCM encryption key for credential-type memories
# Generate with: openssl rand -hex 32
# CRITICAL: back this up — losing it makes encrypted memories permanently unreadable
ENCRYPTION_KEY=change_me_encryption_key
```

---

## Architecture

### Component Overview

```
memoryai/
├── packages/
│   ├── api/                   Node.js 20 + TypeScript + Fastify 5
│   │   └── src/
│   │       ├── config.ts      Typed env config with Zod validation at startup
│   │       ├── index.ts       Server entrypoint + graceful shutdown
│   │       ├── db/pool.ts     PostgreSQL connection pool + transaction helper
│   │       ├── middleware/
│   │       │   └── auth.middleware.ts   Bearer token → user lookup
│   │       ├── routes/
│   │       │   ├── memories.route.ts    /v1/memories — CRUD + search
│   │       │   ├── sessions.route.ts    /v1/sessions — lifecycle + messages
│   │       │   └── entities.route.ts    /v1/entities — upsert + search
│   │       ├── services/
│   │       │   ├── memory.service.ts    Core CRUD + hybrid search query
│   │       │   ├── session.service.ts   Session lifecycle + message buffer
│   │       │   ├── entity.service.ts    Entity upsert + vector search
│   │       │   ├── embedding.service.ts Multi-provider abstraction (Ollama/Gemini/OpenAI)
│   │       │   └── auth.service.ts      API key creation + validation
│   │       ├── mcp/
│   │       │   └── server.ts            MCP JSON-RPC 2.0 over HTTP + SSE (6 tools)
│   │       └── jobs/
│   │           ├── distillation.queue.ts   BullMQ queue definition
│   │           └── distillation.worker.ts  Background LLM extraction + inactivity scheduler
│   ├── dashboard/             React + Vite admin UI (in development)
│   ├── sdk/                   TypeScript client SDK — @memoryai/client (in development)
│   └── shared/                Shared TypeScript types (Memory, Session, Entity, etc.)
├── integrations/
│   └── claude-code/
│       ├── mcp-local-ai.py    Stdio MCP server for multi-model orchestration
│       └── ask-model.py       CLI tool for direct model calls
├── openwebui/
│   ├── memoryai_filter.py     Open WebUI global filter (auto-inject memories)
│   └── memoryai_tools.py      Open WebUI explicit tools
├── docker/
│   ├── docker-compose.yml     PostgreSQL 16+pgvector, Redis 7, API service
│   ├── Dockerfile.api         Multi-stage production Docker build
│   └── postgres/
│       ├── init.sql           Full DB schema, vector indexes, hybrid search functions
│       └── seed.sql           Initial data (default admin user)
├── scripts/
│   ├── setup.sh               First-time setup automation
│   └── create-vector-index.sh Build HNSW index after bulk data import
├── install.py                 Universal IDE installer (served via /dashboard/install.py)
└── .env.example               All configuration variables documented
```

### Database Schema

```sql
-- API key management and multi-user support
users (
  id UUID PRIMARY KEY,
  api_key TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ
)

-- Optional namespace for isolating memories between projects
projects (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ
)

-- Conversation tracking
sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users,
  context TEXT,
  status TEXT,              -- open | closed | distilling | distilled
  message_count INTEGER,
  last_activity_at TIMESTAMPTZ,
  distilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)

-- Raw message buffer — input for distillation
session_messages (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES sessions,
  role TEXT,                -- user | assistant | system
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ
)

-- Long-term persistent memories
memories (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users,
  session_id UUID REFERENCES sessions,
  content TEXT NOT NULL,
  type TEXT,                -- fact | decision | preference | instruction | entity_relation | summary
  importance FLOAT DEFAULT 0.5,
  embedding VECTOR(768),    -- pgvector column (dimension configurable)
  content_tsv TSVECTOR,     -- for full-text search
  tags TEXT[],
  pinned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

-- Named entity knowledge graph
entities (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users,
  name TEXT NOT NULL,
  type TEXT,                -- person | project | company | system | tool | server | other
  embedding VECTOR(768),
  UNIQUE(user_id, name)
)

-- Entity facts (one entity → many facts)
entity_facts (
  id UUID PRIMARY KEY,
  entity_id UUID REFERENCES entities,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ
)

-- BullMQ job tracking
distillation_jobs (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES sessions,
  bullmq_job_id TEXT,
  status TEXT,              -- queued | processing | done | failed
  error TEXT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
)
```

**Indexes:**
- `memories.embedding` — HNSW vector index (ivfflat by default, HNSW optional via `create-vector-index.sh`)
- `memories.content_tsv` — GIN index for full-text search
- `memories.user_id`, `memories.type`, `memories.importance` — composite B-tree index for filtered search
- `entities.embedding` — HNSW/ivfflat index for entity semantic search
- `sessions.user_id, last_activity_at` — index for inactivity worker queries

### Tech Stack

| Layer | Technology |
|-------|-----------|
| API server | Node.js 20 + TypeScript 5 + Fastify 5 |
| Database | PostgreSQL 16 + pgvector 0.7 |
| Cache and queue | Redis 7 + BullMQ 5 |
| MCP transport | HTTP + SSE (JSON-RPC 2.0, MCP protocol 2024-11-05) |
| Input validation | Zod |
| Container | Docker + Docker Compose v2 |
| Embeddings | Ollama / Google Gemini / OpenAI (provider-agnostic abstraction) |
| Distillation | Ollama / Gemini Flash / Anthropic Claude Haiku |
| Multi-agent | Python 3 stdio MCP server + ConnectRPC client |

---

## Project Structure

```
memoryai/
├── .env.example                         All configuration variables with documentation
├── .gitignore
├── install.py                           Universal IDE installer (served as /dashboard/install.py)
├── docker/
│   ├── docker-compose.yml               PostgreSQL 16+pgvector + Redis 7 + API service
│   ├── Dockerfile.api                   Multi-stage production build (builder → runtime)
│   └── postgres/
│       ├── init.sql                     DB schema, vector index, hybrid search SQL function
│       └── seed.sql                     Initial admin user row
├── integrations/
│   └── claude-code/
│       ├── mcp-local-ai.py              Stdio MCP server: ask_gemini, ask_model, ask_ollama, list tools
│       └── ask-model.py                 CLI: call any model from the terminal
├── openwebui/
│   ├── memoryai_filter.py               Global filter: auto-inject memories into every chat
│   └── memoryai_tools.py                Explicit tools: search, save, entity operations
├── packages/
│   ├── shared/
│   │   └── src/
│   │       └── types.ts                 Shared TypeScript types: Memory, Session, Entity, etc.
│   ├── api/
│   │   ├── package.json
│   │   └── src/
│   │       ├── config.ts                Typed env config, startup validation
│   │       ├── index.ts                 Fastify app setup + graceful shutdown
│   │       ├── db/
│   │       │   └── pool.ts              PostgreSQL pool + withTransaction helper
│   │       ├── middleware/
│   │       │   └── auth.middleware.ts   API key → User object + attach to request
│   │       ├── routes/
│   │       │   ├── memories.route.ts    Full CRUD + hybrid search
│   │       │   ├── sessions.route.ts    Session lifecycle + message endpoints
│   │       │   └── entities.route.ts    Entity upsert + fact management + search
│   │       ├── services/
│   │       │   ├── memory.service.ts    Hybrid search query + CRUD
│   │       │   ├── session.service.ts   Open/close/inactivity timer
│   │       │   ├── entity.service.ts    Upsert by name + vector search
│   │       │   ├── embedding.service.ts Provider abstraction: embed(text) → Float32Array
│   │       │   └── auth.service.ts      nanoid key generation + validation
│   │       ├── mcp/
│   │       │   └── server.ts            JSON-RPC 2.0 handler + 6 tool implementations
│   │       └── jobs/
│   │           ├── distillation.queue.ts  BullMQ queue + job type definitions
│   │           └── distillation.worker.ts Worker: LLM prompt + memory extraction + scheduler
│   ├── dashboard/                       React + Vite UI (in development)
│   └── sdk/                             @memoryai/client TypeScript SDK (in development)
└── scripts/
    ├── setup.sh                         First-time setup: .env generation, Docker, IDE config
    └── create-vector-index.sh           Build HNSW index for large datasets
```

---

## System Requirements

### Minimum (development / light use)

| Component | Minimum |
|-----------|---------|
| CPU | 2 cores |
| RAM | 2 GB (PostgreSQL 512 MB + Redis 256 MB + API 256 MB) |
| Disk | 5 GB |
| Node.js | 20 LTS |
| Docker | 24+ with Compose v2 |
| PostgreSQL | 16+ (via `pgvector/pgvector:pg16` Docker image) |
| Redis | 7+ |
| Python | 3.8+ (for `mcp-local-ai.py` and `ask-model.py`) |

### Recommended (production)

| Component | Recommended |
|-----------|-------------|
| CPU | 4+ cores |
| RAM | 8 GB (headroom for pgvector HNSW index and large embedding batches) |
| Disk | 50+ GB SSD (grows with memories; 768-dim vector ≈ 3–4 KB per memory) |
| Node.js | 20 LTS |

### Ollama models for local embeddings and distillation

| Model | Type | RAM / VRAM | Notes |
|-------|------|-----------|-------|
| `nomic-embed-text` | Embedding | 274 MB | Default — good quality, English + Polish |
| `bge-m3` | Embedding | 570 MB | Best for multilingual / Polish-heavy content; use with `EMBED_DIMENSIONS=1024` |
| `qwen2.5:7b` | Distillation | 4.7 GB | Recommended — strong structured fact extraction |
| `qwen2.5:3b` | Distillation | 2.0 GB | Lighter alternative, slightly lower extraction quality |
| `llama3.2:3b` | Distillation | 2.0 GB | English-focused alternative |

Ollama loads models on demand and unloads them after the idle timeout. Running embedding and distillation simultaneously with the recommended models requires approximately 5–6 GB RAM or VRAM.

### Storage Growth Estimates

| Metric | Size |
|--------|------|
| 1 memory (768-dim vector + text) | ~3–4 KB in PostgreSQL |
| 1,000 memories | ~4 MB |
| 10,000 memories | ~40 MB |
| 100,000 memories | ~400 MB |
| 1 session (50 messages) | ~50–200 KB |

After 1 year of active daily use (10 sessions/day, 5 memories extracted per session): approximately 18,000 memories = ~72 MB. Entirely manageable on any modern system.

### Runtime Memory Usage

| Service | Idle RAM | Peak RAM |
|---------|----------|----------|
| PostgreSQL + pgvector | ~100 MB | ~512 MB |
| Redis | ~10 MB | ~256 MB |
| MemoryAI API | ~80 MB | ~200 MB |
| Ollama (nomic-embed-text loaded) | ~300 MB | ~500 MB |
| **Total** | **~490 MB** | **~1.5 GB** |

### Network Latency

| Operation | Typical latency |
|-----------|----------------|
| Embedding (local Ollama, GPU) | 10–50 ms |
| Embedding (Gemini API) | 100–300 ms |
| Hybrid search (PostgreSQL) | 5–20 ms |
| Distillation (Gemini Flash) | 500–2,000 ms per session |
| Distillation (local qwen2.5:7b, CPU) | 5–30 s per session |
| Distillation (local qwen2.5:7b, GPU) | 1–5 s per session |
| `ask_gemini` call (via local-ai MCP) | 200–2,000 ms depending on model |
| `ask_ollama` call (qwen3.5:4b, GPU) | 500–3,000 ms |

---

## Distillation Details

Distillation is the process that converts a raw session message history into structured, persistent long-term memories. It runs entirely in the background via BullMQ and Redis and never blocks the API or the user.

### Triggers

Distillation is triggered by whichever condition fires first:

1. **Inactivity timer** — `DISTILL_INACTIVITY_MINUTES` (default: 15) minutes with no new messages in the session. The distillation worker checks for stale sessions every 1 minute.
2. **Message count** — every `DISTILL_EVERY_N_MESSAGES` messages, if this variable is set and > 0.
3. **Manual close** — `session_end` MCP tool or `POST /v1/sessions/:id/close` REST endpoint.

### Distillation Process Step by Step

```
Session marked as 'closed'
        │
        ▼
BullMQ job enqueued: "distill-{sessionId}"
(job ID uses dashes, not colons — colons are Redis key separators)
        │
        ▼
Worker polls Redis queue every ~1 minute
        │
        ▼
Worker picks up job → session status set to 'distilling'
        │
        ▼
Fetch all session_messages WHERE session_id = ? ORDER BY created_at
        │
        ▼
Build distillation prompt:
  System: "You are a memory extraction assistant..."
  User: "Extract facts, decisions, preferences, instructions from:\n{messages}"
        │
        ▼
Call distillation LLM (Ollama / Gemini / Anthropic)
        │
        ▼
Parse structured JSON response:
  [
    {"type": "decision", "content": "...", "importance": 0.9, "tags": [...]},
    {"type": "preference", "content": "...", "importance": 0.7, ...},
    {"type": "entity", "name": "...", "entity_type": "...", "facts": [...]}
  ]
        │
        ▼
Save memories → INSERT INTO memories (with embeddings)
Save entities → UPSERT entities + entity_facts
        │
        ▼
Session status set to 'distilled'
Raw messages optionally pruned (configurable)
```

### Distillation Provider Comparison

| Provider | Speed | Privacy | Cost | Best for |
|----------|-------|---------|------|----------|
| Ollama (qwen2.5:7b, GPU) | 1–5 s/session | 100% local | Free | Privacy-first setups |
| Ollama (qwen2.5:7b, CPU) | 5–30 s/session | 100% local | Free | Low-cost home servers |
| Gemini Flash | 0.5–2 s/session | Cloud | Low | Best price/quality ratio |
| Anthropic Claude Haiku | 1–3 s/session | Cloud | Low-medium | Most structured output |

### Weekly Maintenance Jobs

Two weekly jobs run automatically to keep memory quality high:

**Temporal consolidation** — finds groups of semantically similar memories (cosine similarity > 0.92) created in the same time window and merges them into a single, richer memory. Prevents semantic drift from repeated distillations of similar sessions.

**Deduplication** — finds memories with very high similarity (> 0.98) and removes older duplicates, keeping the highest-importance version. Prevents bloat from redundant facts.

### Customizing the Distillation Prompt

The distillation prompt is in `packages/api/src/jobs/distillation.worker.ts` and can be freely customized. Useful customizations:
- Add language instructions ("Always extract in English regardless of conversation language")
- Add domain-specific fact types for your use case
- Adjust the importance scoring guidelines
- Add a list of topics to specifically watch for and always extract

### Quality Tips

- **Keep sessions focused** — distillation quality degrades with very long, topic-switching conversations. If a conversation shifts topic significantly, end the session and start a new one.
- **Gemini Flash** is the best price/quality ratio in most cases.
- **Anthropic Claude Haiku** produces the most consistently structured and correctly tagged output.
- **Local qwen2.5:7b** is surprisingly good for Polish content and works entirely offline.
- Sessions with fewer than 5 messages are not distilled by default (configurable threshold) to avoid noise.

---

## Security

### Authentication

- All REST and MCP endpoints require `Authorization: Bearer <key>` — there is no unauthenticated surface
- API keys are cryptographically random 48-character strings generated by `nanoid`
- The initial admin key is set at startup via `ADMIN_API_KEY` — it is hashed before storage
- Additional API keys can be created via the REST API by an authenticated admin
- Rotate a key by deleting it via the API and creating a new one — the old key is immediately invalidated

### Data Isolation

- Every database query is scoped by `user_id` — there is no mechanism for one user to access another user's memories, sessions, or entities
- `session_end` verifies session ownership before closing
- `addMessage` verifies session ownership inside a database transaction
- There is no admin endpoint to read another user's memories in plain text

### SQL Injection Prevention

- All queries use **parameterized prepared statements** exclusively — no string interpolation anywhere in SQL
- Zod validates all inputs before they reach the service layer — invalid inputs are rejected at the route level
- Enum values (`type`, `status`, etc.) are validated by Zod, never interpolated into query strings

### Input Validation

- All REST endpoints have Zod schemas at the route level — missing or wrongly typed fields return 400 with details
- MCP tool arguments are validated with explicit type checks before any processing
- String length limits enforced: `content` max 10,000 characters, `name` max 255 characters
- Array fields have maximum length limits to prevent DoS via oversized payloads

### Rate Limiting

- Default: 10,000 requests per minute per API key (configurable via `RATE_LIMIT_RPM`)
- Implemented via `@fastify/rate-limit` backed by Redis — limits are shared across API instances
- Returns `HTTP 429 Too Many Requests` with `Retry-After` header when exceeded

### Security Headers

- `@fastify/helmet` adds standard HTTP security headers on every response:
  - `Content-Security-Policy`
  - `Strict-Transport-Security` (HSTS)
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- CORS is restricted to explicit allowed origins via the `CORS_ORIGINS` env var (no wildcard in production)

### Encryption at Rest

- Memories tagged with type `credentials` (or when `ENCRYPTION_KEY` is configured) are encrypted with AES-256-GCM before storage
- The encryption key is never stored in the database — it must be provided at runtime via `ENCRYPTION_KEY`
- **Critical:** Back up your `ENCRYPTION_KEY`. Losing it makes encrypted memories permanently unreadable.

### What Is Not Included (v0.1)

- User registration UI — admin creates users via the REST API
- OAuth2 / SSO login
- Audit logs / access history
- Automatic key rotation

---

## Roadmap

- [ ] **React Dashboard** (`packages/dashboard`) — browse memories, search, edit, view distillation job status, analytics, memory graph visualization
- [ ] **TypeScript SDK** (`packages/sdk`, `@memoryai/client`) — typed client for easy integration in any Node.js application
- [ ] **Python SDK** (`pip install memoryai`) — for Python environments, Jupyter notebooks, LangChain, LlamaIndex
- [ ] **Proxy middleware** — transparent OpenAI-compatible API proxy that auto-injects memory context and auto-saves model responses, with zero model-side changes
- [ ] **Memory decay** — reduce importance scores of old, unused memories automatically; optionally archive or delete them
- [ ] **Multi-user admin UI** — user management, per-user memory quotas, usage statistics
- [ ] **Export / import** — backup and restore all memories as portable JSON; import from ChatGPT Memory, Mem0, etc.
- [ ] **Memory consolidation** — periodic automatic deduplication and merging of similar memories (weekly job already in queue, UI and tuning coming)
- [ ] **Project namespacing** — isolate memories per-project so different AI agents working on different codebases do not contaminate each other's context
- [ ] **Web search enrichment** — optionally enrich memories with web search results at distillation time for better context
- [ ] **Pinned memory UI** — easily pin / unpin memories from the dashboard

---

## License

MIT
