#!/usr/bin/env python3
"""
Local MCP server: exposes AI model access via the Antigravity language server.
Provides ask_gemini and ask_model MCP tools that work fully offline
(no API keys needed — uses the existing Antigravity OAuth session).

Register in MCP config:
  {
    "mcpServers": {
      "local-ai": {
        "command": "python3",
        "args": ["/config/.claude/hooks/mcp-local-ai.py"]
      }
    }
  }
"""

import sys
import json
import re
import socket
import ssl
import subprocess
import urllib.request
import urllib.error
import logging

logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
log = logging.getLogger("mcp-local-ai")

OLLAMA_URL = "http://100.99.158.2:11434"

# ── Model registry ─────────────────────────────────────────────────────────────

MODEL_IDS = {
    "gemini-2.5-flash":           "MODEL_GOOGLE_GEMINI_2_5_FLASH",
    "gemini-2.5-flash-lite":      "MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE",
    "gemini-2.5-flash-thinking":  "MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING",
    "gemini-2.5-pro":             "MODEL_GOOGLE_GEMINI_2_5_PRO",
    "gemini-3-flash":             "MODEL_PLACEHOLDER_M18",
    "gemini-3.1-flash-lite":      "MODEL_PLACEHOLDER_M50",
    "gemini-3.1-pro-low":         "MODEL_PLACEHOLDER_M36",
    "gemini-3.1-pro-high":        "MODEL_PLACEHOLDER_M37",
    "gemini-3.5-flash-medium":    "MODEL_PLACEHOLDER_M20",
    "gemini-3.5-flash-high":      "MODEL_PLACEHOLDER_M132",
    "claude-sonnet-4-6":          "MODEL_PLACEHOLDER_M35",
    "claude-opus-4-6-thinking":   "MODEL_PLACEHOLDER_M26",
    "gpt-oss-120b":               "MODEL_OPENAI_GPT_OSS_120B_MEDIUM",
}

_cached_conn = None  # (csrf, port)


# ── Language server connection ──────────────────────────────────────────────────

def _get_connection():
    global _cached_conn
    if _cached_conn:
        # Verify it still works
        try:
            result = _call_raw(*_cached_conn, 'Heartbeat', {}, timeout=2)
            if 'lastExtensionHeartbeat' in str(result):
                return _cached_conn
        except Exception:
            pass
        _cached_conn = None

    try:
        ps = subprocess.run(['ps', 'aux'], capture_output=True, text=True)
        for line in ps.stdout.split('\n'):
            if 'language_server_linux_x64' not in line:
                continue
            csrf_m = re.search(r'--csrf_token\s+([a-f0-9-]{36})', line)
            if not csrf_m:
                continue
            csrf = csrf_m.group(1)
            for port in [44751, 43951, 43337, 43205]:
                try:
                    result = _call_raw(csrf, port, 'Heartbeat', {}, timeout=2)
                    if 'lastExtensionHeartbeat' in str(result):
                        _cached_conn = (csrf, port)
                        return _cached_conn
                except Exception:
                    pass
    except Exception as e:
        log.error("Connection error: %s", e)

    raise RuntimeError("Antigravity language server not found. Is Antigravity running?")


def _call_raw(csrf, port, method, payload, timeout=30):
    sock = socket.create_connection(('127.0.0.1', port), timeout=5)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    conn = ctx.wrap_socket(sock)
    try:
        body = json.dumps(payload).encode()
        path = f"/exa.language_server_pb.LanguageServerService/{method}"
        req = (
            f"POST {path} HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{port}\r\n"
            f"x-codeium-csrf-token: {csrf}\r\n"
            f"Content-Type: application/json\r\n"
            f"Connect-Protocol-Version: 1\r\n"
            f"Content-Length: {len(body)}\r\n"
            f"Connection: close\r\n\r\n"
        ).encode() + body
        conn.sendall(req)
        conn.settimeout(timeout)
        data = b""
        try:
            while True:
                chunk = conn.recv(16384)
                if not chunk:
                    break
                data += chunk
        except socket.timeout:
            pass
    finally:
        conn.close()

    sep = b"\r\n\r\n"
    if sep not in data:
        raise RuntimeError(f"No HTTP response from language server")
    body_start = data.index(sep) + 4
    raw_body = data[body_start:]
    clean = re.sub(rb'[0-9a-f]+\r\n', b'', raw_body).replace(b'\r\n', b'')
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        return clean.decode(errors='replace')


def _ask(prompt: str, model: str = "gemini-2.5-flash", system: str = None, timeout: int = 30) -> str:
    csrf, port = _get_connection()
    model_id = MODEL_IDS.get(model, model)
    payload = {"prompt": prompt, "model": model_id}
    if system:
        payload["systemPrompt"] = system
    result = _call_raw(csrf, port, 'GetModelResponse', payload, timeout=timeout)
    if isinstance(result, dict):
        if 'response' in result:
            return result['response']
        if 'code' in result:
            raise RuntimeError(result.get('message', str(result)))
    return str(result)


def _ask_ollama(prompt: str, model: str = "qwen3.5:4b", system: str = None, timeout: int = 120) -> str:
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
    }
    if system:
        payload["system"] = system
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            result = json.loads(r.read())
            return result.get("response", str(result))
    except urllib.error.URLError as e:
        raise RuntimeError(f"Ollama not reachable ({OLLAMA_URL}): {e}")


def _list_ollama_models() -> list[str]:
    try:
        req = urllib.request.Request(f"{OLLAMA_URL}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
            return [m["name"] for m in data.get("models", [])]
    except Exception as e:
        raise RuntimeError(f"Ollama not reachable: {e}")


# ── MCP stdio server ────────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "ask_gemini",
        "description": (
            "Ask Gemini a question and get a response. "
            "Uses Gemini 2.5 Flash by default (fast and free). "
            "Works without an API key — uses the existing Antigravity session."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "The question or prompt to send to Gemini",
                },
                "model": {
                    "type": "string",
                    "description": (
                        "Model to use. Options: gemini-2.5-flash (default), "
                        "gemini-2.5-flash-thinking, gemini-3.1-pro-low, gemini-3.1-pro-high, "
                        "gemini-3.5-flash-medium, gemini-3.5-flash-high"
                    ),
                    "default": "gemini-2.5-flash",
                },
                "system": {
                    "type": "string",
                    "description": "Optional system prompt to set the model's behavior",
                },
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "ask_model",
        "description": (
            "Ask any AI model available in Antigravity. "
            "Supports Gemini, Claude, and GPT models. "
            "Use list_models to see what's available."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "The question or prompt",
                },
                "model": {
                    "type": "string",
                    "description": (
                        "Model alias. Examples: gemini-2.5-flash, gemini-3.1-pro-high, "
                        "claude-sonnet-4-6, claude-opus-4-6-thinking, gpt-oss-120b"
                    ),
                },
                "system": {
                    "type": "string",
                    "description": "Optional system prompt",
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds (default 30)",
                    "default": 30,
                },
            },
            "required": ["prompt", "model"],
        },
    },
    {
        "name": "list_ai_models",
        "description": "List all AI models available through Antigravity (no API key needed).",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "ask_ollama",
        "description": (
            "Ask a locally running Ollama model on the Dell server. "
            "Available models include: llama3.1:8b, llama3:latest, mistral:latest, "
            "codellama:latest, deepseek-coder:6.7b, qwen2.5:7b-instruct-q4_K_M, "
            "codestral:22b, mistral-nemo:latest and more. "
            "Runs fully locally — no internet or API key needed."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "The question or prompt",
                },
                "model": {
                    "type": "string",
                    "description": (
                        "Ollama model name. Examples: llama3.1:8b (default), "
                        "mistral:latest, codellama:latest, deepseek-coder:6.7b, "
                        "qwen2.5:7b-instruct-q4_K_M, codestral:22b"
                    ),
                    "default": "llama3.1:8b",
                },
                "system": {
                    "type": "string",
                    "description": "Optional system prompt",
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds (default 60, use more for large models)",
                    "default": 60,
                },
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "list_ollama_models",
        "description": "List all models available in the local Ollama instance on the Dell server.",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
]


def handle_request(req: dict) -> dict:
    method = req.get("method", "")
    req_id = req.get("id")
    params = req.get("params", {})

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "local-ai", "version": "1.0.0"},
            },
        }

    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}}

    if method == "tools/call":
        tool_name = params.get("name", "")
        args = params.get("arguments", {})
        try:
            if tool_name == "ask_gemini":
                text = _ask(
                    prompt=args["prompt"],
                    model=args.get("model", "gemini-2.5-flash"),
                    system=args.get("system"),
                )
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"content": [{"type": "text", "text": text}]},
                }

            if tool_name == "ask_model":
                text = _ask(
                    prompt=args["prompt"],
                    model=args["model"],
                    system=args.get("system"),
                    timeout=args.get("timeout", 30),
                )
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"content": [{"type": "text", "text": text}]},
                }

            if tool_name == "list_ai_models":
                csrf, port = _get_connection()
                result = _call_raw(csrf, port, 'GetAvailableModels', {})
                models = result.get('response', {}).get('models', {})
                lines = []
                for alias in sorted(models):
                    info = models[alias]
                    provider = info.get('apiProvider', '').replace('API_PROVIDER_', '')
                    lines.append(f"{alias} ({provider})")
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"content": [{"type": "text", "text": "\n".join(lines)}]},
                }

            if tool_name == "ask_ollama":
                text = _ask_ollama(
                    prompt=args["prompt"],
                    model=args.get("model", "llama3.1:8b"),
                    system=args.get("system"),
                    timeout=args.get("timeout", 60),
                )
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"content": [{"type": "text", "text": text}]},
                }

            if tool_name == "list_ollama_models":
                models = _list_ollama_models()
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"content": [{"type": "text", "text": "\n".join(models)}]},
                }

            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"},
            }
        except Exception as e:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32000, "message": str(e)},
            }

    if method == "notifications/initialized":
        return None  # no response for notifications

    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": -32601, "message": f"Method not found: {method}"},
    }


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            resp = handle_request(req)
            if resp is not None:
                sys.stdout.write(json.dumps(resp) + "\n")
                sys.stdout.flush()
        except json.JSONDecodeError as e:
            log.error("JSON decode error: %s", e)
        except Exception as e:
            log.error("Unhandled error: %s", e)


if __name__ == "__main__":
    main()
