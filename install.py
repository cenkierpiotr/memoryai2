#!/usr/bin/env python3
"""
MemoryAI MCP Universal Installer v1.1
Detects OS and installed IDEs, writes MCP configs automatically.

Usage:
  python3 install-memoryai.py           # auto-detect and configure
  python3 install-memoryai.py --force   # overwrite existing configs
  python3 install-memoryai.py --check   # test connection only
  python3 install-memoryai.py --list    # list detected IDEs without writing

One-liner:
  curl -sL https://dell.tailfbeb53.ts.net/install.py | python3
"""

import os, sys, json, platform, shutil, urllib.request, urllib.error
from pathlib import Path

# ─── Config ───────────────────────────────────────────────────────────────────
VERSION  = "1.1"
MCP_URL  = "https://dell.tailfbeb53.ts.net/mcp"
TOKEN    = "Bearer 67c6c37084074ce023f9b9620fa1340279694cdd8613fe5057b95de42f06b4af"
OS_NAME  = platform.system()   # "Linux", "Darwin", "Windows"
HOME     = Path.home()
FORCE    = "--force" in sys.argv
CHECK    = "--check" in sys.argv
LIST     = "--list" in sys.argv

# ─── Colors ───────────────────────────────────────────────────────────────────
_TTY = sys.stdout.isatty() and OS_NAME != "Windows"
G = "\033[92m" if _TTY else ""; R = "\033[91m" if _TTY else ""
Y = "\033[93m" if _TTY else ""; C = "\033[96m" if _TTY else ""
B = "\033[1m"  if _TTY else ""; X = "\033[0m"  if _TTY else ""
ok   = lambda m: print(f"  {G}✓{X} {m}")
err  = lambda m: print(f"  {R}✗{X} {m}")
warn = lambda m: print(f"  {Y}!{X} {m}")
info = lambda m: print(f"  {C}→{X} {m}")

# ─── OS paths ─────────────────────────────────────────────────────────────────
def app_data():
    if OS_NAME == "Windows":
        return Path(os.environ.get("APPDATA", HOME / "AppData/Roaming"))
    if OS_NAME == "Darwin":
        return HOME / "Library/Application Support"
    return HOME / ".config"

def local_app_data():
    if OS_NAME == "Windows":
        return Path(os.environ.get("LOCALAPPDATA", HOME / "AppData/Local"))
    return app_data()

APP   = app_data()
LOCAL = local_app_data()

# ─── IDE definitions ──────────────────────────────────────────────────────────
def ides():
    return [
        {
            "id": "cursor",
            "name": "Cursor",
            "config": HOME / ".cursor" / "mcp.json",
            "detect_dirs":  [HOME / ".cursor"],
            "detect_bins":  ["cursor"],
            "detect_paths": {
                "Darwin":  [Path("/Applications/Cursor.app")],
                "Windows": [LOCAL / "Programs/cursor/Cursor.exe"],
            },
            "schema": "cursor",
        },
        {
            "id": "vscode",
            "name": "VS Code",
            "config": APP / "Code" / "User" / "mcp.json",
            "detect_dirs":  [APP / "Code"],
            "detect_bins":  ["code"],
            "detect_paths": {
                "Darwin":  [Path("/Applications/Visual Studio Code.app")],
                "Windows": [LOCAL / "Programs/Microsoft VS Code/Code.exe"],
            },
            "schema": "vscode",
        },
        {
            "id": "vscode_insiders",
            "name": "VS Code Insiders",
            "config": APP / "Code - Insiders" / "User" / "mcp.json",
            "detect_dirs":  [APP / "Code - Insiders"],
            "detect_bins":  ["code-insiders"],
            "detect_paths": {
                "Darwin":  [Path("/Applications/Visual Studio Code - Insiders.app")],
                "Windows": [LOCAL / "Programs/Microsoft VS Code Insiders/Code - Insiders.exe"],
            },
            "schema": "vscode",
        },
        {
            "id": "windsurf",
            "name": "Windsurf",
            "config": HOME / ".windsurf" / "mcp.json",
            "detect_dirs":  [HOME / ".windsurf", APP / "Windsurf"],
            "detect_bins":  ["windsurf"],
            "detect_paths": {
                "Darwin":  [Path("/Applications/Windsurf.app")],
                "Windows": [LOCAL / "Programs/Windsurf/Windsurf.exe"],
            },
            "schema": "windsurf",
        },
        {
            "id": "continue",
            "name": "Continue.dev  (VS Code + JetBrains)",
            "config": HOME / ".continue" / "config.json",
            "detect_dirs":  [HOME / ".continue"],
            "detect_bins":  [],
            "detect_paths": {
                "Darwin":  [],
                "Windows": [],
                "Linux":   [],
            },
            "schema": "continue",
        },
        {
            "id": "claude_desktop",
            "name": "Claude Desktop",
            "config": {
                "Linux":   HOME / ".config/claude/claude_desktop_config.json",
                "Darwin":  HOME / "Library/Application Support/Claude/claude_desktop_config.json",
                "Windows": APP / "Claude/claude_desktop_config.json",
            }.get(OS_NAME, HOME / ".config/claude/claude_desktop_config.json"),
            "detect_dirs":  [],
            "detect_bins":  [],
            "detect_paths": {
                "Darwin":  [Path("/Applications/Claude.app")],
                "Windows": [APP / "Claude"],
                "Linux":   [HOME / ".config/claude"],
            },
            "schema": "cursor",  # same schema: mcpServers[name].url + headers
        },
    ]

# ─── Config builders ──────────────────────────────────────────────────────────
def _cursor_entry():
    return {"url": MCP_URL, "headers": {"Authorization": TOKEN}}

def _vscode_entry():
    return {"type": "http", "url": MCP_URL, "headers": {"Authorization": TOKEN}}

def _windsurf_entry():
    return {"serverUrl": MCP_URL, "headers": {"Authorization": TOKEN}}

def _continue_entry():
    return {
        "name": "memoryai",
        "transport": {
            "type": "http",
            "url": MCP_URL,
            "requestOptions": {"headers": {"Authorization": TOKEN}},
        },
    }

def merge_config(schema, existing=None):
    cfg = existing or {}
    if schema == "cursor":
        cfg.setdefault("mcpServers", {})
        cfg["mcpServers"]["memoryai"] = _cursor_entry()
    elif schema == "vscode":
        cfg.setdefault("servers", {})
        cfg["servers"]["memoryai"] = _vscode_entry()
    elif schema == "windsurf":
        cfg.setdefault("mcpServers", {})
        cfg["mcpServers"]["memoryai"] = _windsurf_entry()
    elif schema == "continue":
        lst = [s for s in cfg.get("mcpServers", []) if isinstance(s, dict) and s.get("name") != "memoryai"]
        lst.append(_continue_entry())
        cfg["mcpServers"] = lst
    return cfg

# ─── Helpers ─────────────────────────────────────────────────────────────────
def is_installed(ide):
    for d in ide.get("detect_dirs", []):
        if d and Path(d).exists():
            return True
    for b in ide.get("detect_bins", []):
        if shutil.which(b):
            return True
    for p in ide.get("detect_paths", {}).get(OS_NAME, []):
        if p and Path(p).exists():
            return True
    return False

def already_configured(path, schema):
    """Returns True if memoryai is already present in the config file."""
    if not path.exists():
        return False
    try:
        cfg = json.loads(path.read_text(encoding="utf-8"))
        if schema == "continue":
            return any(isinstance(s, dict) and s.get("name") == "memoryai" for s in cfg.get("mcpServers", []))
        key = "servers" if schema == "vscode" else "mcpServers"
        return "memoryai" in cfg.get(key, {})
    except Exception:
        return False

def write_config(ide):
    path = Path(ide["config"])
    schema = ide["schema"]

    if already_configured(path, schema) and not FORCE:
        info(f"{ide['name']}: already configured  (--force to update)")
        return "skip"

    existing = None
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            backup = str(path) + ".bak"
            shutil.copy(path, backup)
            warn(f"{ide['name']}: corrupt config backed up → {backup}")

    path.parent.mkdir(parents=True, exist_ok=True)
    cfg = merge_config(schema, existing)
    path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    ok(f"{ide['name']}: {path}")
    return "ok"

# ─── Connection test ──────────────────────────────────────────────────────────
def test_connection():
    try:
        req = urllib.request.Request(
            MCP_URL,
            data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).encode(),
            headers={"Authorization": TOKEN, "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
            tools = [t["name"] for t in data.get("result", {}).get("tools", [])]
            ok(f"Connected — {len(tools)} tools: {', '.join(tools)}")
            return True
    except urllib.error.URLError as e:
        err(f"Cannot reach {MCP_URL}")
        err(f"  {e.reason}")
        err(f"  Make sure the server is running and accessible.")
        return False
    except Exception as e:
        err(f"Connection error: {e}")
        return False

# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    print(f"\n{B}MemoryAI MCP Installer v{VERSION}{X}")
    print(f"OS: {OS_NAME} {platform.release()} | Python {sys.version.split()[0]}")
    print(f"Server: {C}{MCP_URL}{X}\n")

    # Step 1 — connection
    print(f"{B}1. Testing connection...{X}")
    if not test_connection():
        print(f"\n{R}Server unreachable.{X}")
        print(f"  • Make sure you're on the Tailscale network")
        print(f"  • Or check: https://dell.tailfbeb53.ts.net/mcp\n")
        sys.exit(1)

    if CHECK:
        sys.exit(0)

    # Step 2 — detect
    print(f"\n{B}2. Detecting installed IDEs...{X}")
    found, missing = [], []
    for ide in ides():
        (found if is_installed(ide) else missing).append(ide)

    if missing:
        info(f"Not detected: {', '.join(i['name'] for i in missing)}")
    if not found:
        print(f"\n{Y}No supported IDEs detected.{X}")
        print(f"Supported: Cursor, VS Code, Windsurf, Continue.dev, Claude Desktop")
        sys.exit(0)

    for ide in found:
        ok(f"Found: {ide['name']}")

    if LIST:
        sys.exit(0)

    # Step 3 — write configs
    print(f"\n{B}3. Writing MCP configs...{X}")
    counts = {"ok": 0, "skip": 0, "error": 0}
    for ide in found:
        try:
            r = write_config(ide)
            counts[r] = counts.get(r, 0) + 1
        except Exception as e:
            err(f"{ide['name']}: {e}")
            counts["error"] += 1

    # Step 4 — system prompt hint
    print(f"\n{B}4. System prompt (for models without native MCP):{X}")
    print(f"""{C}
  You have access to a persistent memory system via MCP tools (memoryai server).
  Tools: memory_get_context, memory_save, memory_search, entity_save, entity_get, session_end.
  - Load memory only on demand when the user asks ("check memory", "what do you know about X")
  - Save important facts, decisions, and preferences proactively during the conversation
  - Call session_end when the conversation ends to trigger memory distillation
{X}""")

    # Summary
    configured = counts["ok"]
    skipped    = counts["skip"]
    errors     = counts["error"]
    print(f"{B}Summary:{X} {G}{configured} configured{X}  {Y}{skipped} already set up{X}  {R}{errors} errors{X}")
    if configured > 0:
        print(f"\n{Y}→ Restart your IDE(s) to activate the MemoryAI MCP server.{X}\n")
    else:
        print()


if __name__ == "__main__":
    main()
