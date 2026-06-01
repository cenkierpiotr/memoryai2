#!/usr/bin/env bash
# MemoryAI — Create IVFFlat vector index
#
# Run AFTER loading initial data (at least 100 memories with embeddings).
# The index dramatically speeds up vector search at scale.
# Safe to re-run — drops and recreates the index with updated list count.
#
# Usage: bash scripts/create-vector-index.sh [API_URL] [API_KEY]
# Or via API: POST /v1/admin/vector-index/create

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

API_URL="${1:-$(grep MCP_SERVER_URL "$ROOT_DIR/.env" 2>/dev/null | cut -d= -f2 | sed 's|/mcp||' || echo 'http://localhost:3001')}"
API_KEY="${2:-$(grep ADMIN_API_KEY "$ROOT_DIR/.env" 2>/dev/null | cut -d= -f2 || echo '')}"

if [[ -z "$API_KEY" ]]; then
  error "API key not found. Pass as second argument or ensure .env has ADMIN_API_KEY."
fi

info "Checking vector index status at $API_URL..."

STATUS=$(curl -sf -H "Authorization: Bearer $API_KEY" "$API_URL/v1/admin/vector-index/status" 2>/dev/null || echo '{}')
VECTORS=$(echo "$STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('vectors_count',0))" 2>/dev/null || echo 0)
INDEX_EXISTS=$(echo "$STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('index_exists',False))" 2>/dev/null || echo False)
LISTS=$(echo "$STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('recommended_lists',10))" 2>/dev/null || echo 10)

echo ""
echo "  Vectors in DB:   $VECTORS"
echo "  Index exists:    $INDEX_EXISTS"
echo "  Recommended lists: $LISTS"
echo ""

if [[ "$VECTORS" -lt 100 ]]; then
  warn "Only $VECTORS vectors found. Add at least 100 memories with embeddings before creating the index."
  warn "The index will be created automatically once you have enough data."
  exit 0
fi

if [[ "$INDEX_EXISTS" == "True" ]]; then
  warn "Index already exists (lists=$LISTS). Re-creating to optimize for current data size..."
fi

info "Creating IVFFlat index (lists=$LISTS) — this may take a few seconds..."

RESULT=$(curl -sf -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  "$API_URL/v1/admin/vector-index/create" 2>/dev/null || echo '{}')

CREATED=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('created',False))" 2>/dev/null || echo False)

if [[ "$CREATED" == "True" ]]; then
  success "IVFFlat index created successfully! (lists=$LISTS, vectors=$VECTORS)"
  echo ""
  echo "  Vector search will now be significantly faster."
  echo "  Re-run this script after adding 10x more memories to re-optimize."
else
  error "Index creation failed. Check API logs for details."
fi
