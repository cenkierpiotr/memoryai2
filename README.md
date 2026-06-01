# MemoryAI

Persistent memory layer for LLMs. Gives models access to facts, decisions, and preferences from previous sessions — automatically, without user prompting.

## How it works

MemoryAI is an MCP server + REST API that sits between your LLM client and your AI sessions:

1. **At session start** — model calls `memory_get_context`, retrieves relevant memories, and has full context from past conversations
2. **During session** — model saves important facts via `memory_save` and `entity_save`
3. **After session** — background worker distills the conversation and extracts persistent memories automatically

## Quick Start

```bash
git clone https://github.com/cenkierpiotr/memoryai
cd memoryai
bash scripts/setup.sh
docker compose -f docker/docker-compose.yml up
```

The setup script automatically configures MCP for:
- **Google Antigravity** (`~/.gemini/antigravity/mcp_config.json`)
- **Claude Code** (`~/.claude/settings.json`)

## MCP Tools

| Tool | Description |
|------|-------------|
| `memory_get_context` | Load relevant memories at session start (called automatically) |
| `memory_save` | Save a fact, decision, or preference |
| `memory_search` | Semantic search across all memories |
| `entity_save` | Save info about a person, project, or company |
| `entity_get` | Retrieve stored entity information |
| `session_end` | Close session and trigger memory distillation |

## REST API

```
GET    /health
POST   /v1/memories/search    # semantic search
GET    /v1/memories            # list memories
POST   /v1/memories            # create memory
POST   /v1/memories/batch      # bulk create
GET    /v1/sessions            # list sessions
POST   /v1/sessions            # create session
POST   /v1/sessions/:id/close  # close & distill
GET    /v1/entities            # list entities
POST   /v1/entities            # upsert entity
GET    /mcp/config             # get MCP config snippets
```

All endpoints require `Authorization: Bearer YOUR_API_KEY`.

## Configuration

Copy `.env.example` to `.env`. Key settings:

| Variable | Description |
|----------|-------------|
| `ADMIN_API_KEY` | Your master API key |
| `EMBEDDING_PROVIDER` | `ollama` / `gemini` / `openai` |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` or `bge-m3` (multilingual) |
| `DISTILL_PROVIDER` | LLM for memory extraction after sessions |
| `DISTILL_MODEL` | e.g. `qwen2.5:7b`, `gemini-2.0-flash-exp` |

## Architecture

```
packages/
  api/        Fastify REST API + MCP server + background worker
  shared/     TypeScript types
  dashboard/  React admin panel (coming soon)
```

Storage: PostgreSQL 16 + pgvector | Redis 7
