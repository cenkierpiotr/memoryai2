#!/usr/bin/env bash
# MemoryAI — first-time setup script
# Run: bash scripts/setup.sh

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║         MemoryAI Setup                ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# ── Check prerequisites ────────────────────────
info "Checking prerequisites..."

command -v docker >/dev/null 2>&1 || error "Docker is not installed"
command -v docker compose >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1 || error "Docker Compose is not installed"
command -v node >/dev/null 2>&1 || error "Node.js is not installed"
command -v npm >/dev/null 2>&1 || error "npm is not installed"

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
[[ "$NODE_VERSION" -ge 20 ]] || error "Node.js >= 20 required (got $(node -v))"

success "Prerequisites OK"

# ── Generate .env ──────────────────────────────
if [[ ! -f .env ]]; then
  info "Generating .env from .env.example..."
  cp .env.example .env

  # Generate random secrets
  JWT_SECRET=$(openssl rand -hex 32)
  ADMIN_API_KEY=$(openssl rand -hex 32)
  POSTGRES_PASSWORD=$(openssl rand -hex 16)
  REDIS_PASSWORD=$(openssl rand -hex 16)
  ENCRYPTION_KEY=$(openssl rand -hex 32)

  sed -i "s/change_me_jwt_secret_min_32_chars_long/$JWT_SECRET/" .env
  sed -i "s/change_me_admin_api_key/$ADMIN_API_KEY/" .env
  sed -i "s/change_me_strong_password/$POSTGRES_PASSWORD/g" .env
  sed -i "s/change_me_redis_password/$REDIS_PASSWORD/g" .env
  sed -i "s/change_me_encryption_key/$ENCRYPTION_KEY/" .env

  # Update DATABASE_URL and REDIS_URL with new passwords
  sed -i "s|postgresql://memoryai:change_me_strong_password|postgresql://memoryai:$POSTGRES_PASSWORD|g" .env
  sed -i "s|redis://:change_me_redis_password|redis://:$REDIS_PASSWORD|g" .env

  success ".env created with random secrets"
  echo ""
  echo -e "${GREEN}Your admin API key: ${YELLOW}$ADMIN_API_KEY${NC}"
  echo -e "${GREEN}Save this key — it's also in .env${NC}"
  echo ""
else
  warn ".env already exists, skipping generation"
  ADMIN_API_KEY=$(grep ADMIN_API_KEY .env | cut -d'=' -f2)
fi

# ── Install dependencies ───────────────────────
info "Installing npm dependencies..."
npm install
success "Dependencies installed"

# ── Start Docker services ──────────────────────
info "Starting PostgreSQL and Redis..."
docker compose -f docker/docker-compose.yml up -d postgres redis

info "Waiting for PostgreSQL to be ready..."
RETRIES=30
until docker compose -f docker/docker-compose.yml exec -T postgres pg_isready -U memoryai -d memoryai >/dev/null 2>&1; do
  ((RETRIES--))
  [[ $RETRIES -eq 0 ]] && error "PostgreSQL failed to start"
  sleep 2
done
success "PostgreSQL is ready"

# ── Detect Ollama and suggest embedding model ──
if command -v ollama >/dev/null 2>&1 || curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
  info "Ollama detected. Checking embedding models..."
  MODELS=$(curl -sf http://localhost:11434/api/tags 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print('\n'.join(m['name'] for m in d.get('models',[])))" 2>/dev/null || echo "")

  if echo "$MODELS" | grep -q "nomic-embed-text"; then
    success "nomic-embed-text found — ready for embeddings"
  elif echo "$MODELS" | grep -q "bge-m3"; then
    info "bge-m3 found — updating .env for multilingual support"
    sed -i "s/OLLAMA_EMBED_MODEL=nomic-embed-text/OLLAMA_EMBED_MODEL=bge-m3/" .env
    sed -i "s/EMBED_DIMENSIONS=768/EMBED_DIMENSIONS=1024/" .env
    success "Using bge-m3 (multilingual, good for Polish)"
  else
    warn "No embedding model found. Installing nomic-embed-text..."
    ollama pull nomic-embed-text 2>/dev/null || warn "Could not pull nomic-embed-text — please run: ollama pull nomic-embed-text"
  fi
fi

# ── Build packages ─────────────────────────────
info "Building TypeScript packages..."
npm run build 2>&1 | tail -5
success "Build complete"

# ── Generate MCP config ────────────────────────
API_PORT=$(grep "^API_PORT=" .env 2>/dev/null | cut -d'=' -f2 || echo "3001")
MCP_URL="http://localhost:${API_PORT}/mcp"

info "Generating MCP configuration files..."

# Antigravity MCP config
mkdir -p "$HOME/.gemini/antigravity"
ANTIGRAVITY_MCP="$HOME/.gemini/antigravity/mcp_config.json"

if [[ -f "$ANTIGRAVITY_MCP" ]] && python3 -c "import json; d=json.load(open('$ANTIGRAVITY_MCP')); print(d.get('mcpServers',{}).get('memoryai',''))" 2>/dev/null | grep -q "memoryai"; then
  warn "Antigravity MCP config already has memoryai entry"
else
  python3 - <<PYEOF
import json, os

config_path = "$ANTIGRAVITY_MCP"
new_entry = {
    "serverUrl": "$MCP_URL/sse",
    "headers": {"Authorization": "Bearer $ADMIN_API_KEY"}
}

try:
    with open(config_path, 'r') as f:
        config = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    config = {}

config.setdefault("mcpServers", {})["memoryai"] = new_entry

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)

print(f"Updated {config_path}")
PYEOF
  success "Antigravity MCP config updated: $ANTIGRAVITY_MCP"
fi

# Claude Code MCP config
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude"

python3 - <<PYEOF
import json, os

settings_path = "$CLAUDE_SETTINGS"
new_entry = {
    "type": "http",
    "url": "$MCP_URL",
    "headers": {"Authorization": "Bearer $ADMIN_API_KEY"}
}

try:
    with open(settings_path, 'r') as f:
        settings = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    settings = {}

settings.setdefault("mcpServers", {})["memoryai"] = new_entry

with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2)

print(f"Updated {settings_path}")
PYEOF
success "Claude Code MCP config updated: $CLAUDE_SETTINGS"

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║                    SETUP COMPLETE                     ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""
success "MemoryAI is ready to start!"
echo ""
echo "  Start:       docker compose -f docker/docker-compose.yml up"
echo "  API:         http://localhost:${API_PORT}/health"
echo "  MCP:         http://localhost:${API_PORT}/mcp"
echo ""
echo -e "  Admin key:   ${YELLOW}$ADMIN_API_KEY${NC}"
echo ""
echo "  Antigravity MCP config: $ANTIGRAVITY_MCP"
echo "  Claude Code config:     $CLAUDE_SETTINGS"
echo ""
warn "Restart Antigravity to load the new MCP server."
echo ""
