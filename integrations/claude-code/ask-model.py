#!/usr/bin/env python3
"""
Ask any AI model via the Antigravity (Windsurf/VS Code fork) language server API.
Works fully offline — uses the local language server that's already authenticated.

Usage:
  python3 ask-model.py "Your prompt here"
  python3 ask-model.py "Your prompt" --model gemini-2.5-flash
  python3 ask-model.py "Your prompt" --model gemini-3.1-pro --system "You are a code reviewer"
  python3 ask-model.py --list-models

Available models (use the alias):
  gemini-2.5-flash        (default, fast and free)
  gemini-2.5-flash-lite
  gemini-2.5-pro          (may be unavailable due to capacity)
  gemini-3.1-pro-low
  gemini-3.1-pro-high
  gemini-3.5-flash-medium
  claude-sonnet-4-6
  claude-opus-4-6-thinking
"""

import sys
import os
import re
import json
import socket
import ssl
import struct
import subprocess
import argparse


MODEL_ALIASES = {
    "gemini-2.5-flash":       "MODEL_GOOGLE_GEMINI_2_5_FLASH",
    "gemini-2.5-flash-lite":  "MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE",
    "gemini-2.5-flash-thinking": "MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING",
    "gemini-2.5-pro":         "MODEL_GOOGLE_GEMINI_2_5_PRO",
    "gemini-3-flash":         "MODEL_PLACEHOLDER_M18",
    "gemini-3.1-flash-lite":  "MODEL_PLACEHOLDER_M50",
    "gemini-3.1-pro-low":     "MODEL_PLACEHOLDER_M36",
    "gemini-3.1-pro-high":    "MODEL_PLACEHOLDER_M37",
    "gemini-3.5-flash-low":   "MODEL_UNSPECIFIED",
    "gemini-3.5-flash-medium": "MODEL_PLACEHOLDER_M20",
    "gemini-3.5-flash-high":  "MODEL_PLACEHOLDER_M132",
    "claude-sonnet-4-6":      "MODEL_PLACEHOLDER_M35",
    "claude-opus-4-6-thinking": "MODEL_PLACEHOLDER_M26",
    "gpt-oss-120b":           "MODEL_OPENAI_GPT_OSS_120B_MEDIUM",
}


def get_ls_connection():
    """Dynamically find the language server port and CSRF token from running processes."""
    try:
        result = subprocess.run(['ps', 'aux'], capture_output=True, text=True)
        for line in result.stdout.split('\n'):
            if 'language_server_linux_x64' not in line:
                continue
            # Extract csrf_token and httpsPort
            csrf_match = re.search(r'--csrf_token\s+([a-f0-9-]{36})', line)
            # The https port is the one where Antigravity connects (44751 pattern)
            # We look for it in ss output
            if csrf_match:
                csrf = csrf_match.group(1)
                pid_match = re.search(r'^\S+\s+(\d+)', line)
                if pid_match:
                    pid = pid_match.group(1)
                    # Find the HTTPS port this PID listens on
                    ss_result = subprocess.run(['ss', '-tlnp'], capture_output=True, text=True)
                    for ss_line in ss_result.stdout.split('\n'):
                        if f'pid={pid},' in ss_line:
                            port_match = re.search(r':(\d+)\s+0\.0\.0\.0:\*', ss_line)
                            if port_match:
                                port = int(port_match.group(1))
                                # Test if it's HTTPS
                                try:
                                    test = _call_raw(csrf, port, 'Heartbeat', {}, timeout=2)
                                    if 'lastExtensionHeartbeat' in str(test):
                                        return csrf, port
                                except:
                                    pass
    except Exception:
        pass
    # Fallback to known values
    return _find_csrf_fallback()


def _find_csrf_fallback():
    """Try common ports with dynamic CSRF."""
    try:
        result = subprocess.run(['ps', 'aux'], capture_output=True, text=True)
        for line in result.stdout.split('\n'):
            if 'language_server_linux_x64' not in line:
                continue
            csrf_match = re.search(r'--csrf_token\s+([a-f0-9-]{36})', line)
            if not csrf_match:
                continue
            csrf = csrf_match.group(1)
            for port in [44751, 43951, 43337, 43205]:
                try:
                    test = _call_raw(csrf, port, 'Heartbeat', {}, timeout=2)
                    if 'lastExtensionHeartbeat' in str(test):
                        return csrf, port
                except:
                    pass
    except Exception:
        pass
    raise RuntimeError("Could not connect to Antigravity language server. Is Antigravity running?")


def _call_raw(csrf, port, method, payload, timeout=15, use_ssl=True):
    """Make a raw ConnectRPC call to the language server."""
    sock = socket.create_connection(('127.0.0.1', port), timeout=5)
    if use_ssl:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        conn = ctx.wrap_socket(sock)
    else:
        conn = sock

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
    conn.close()

    sep = b"\r\n\r\n"
    if sep not in data:
        raise RuntimeError(f"No HTTP response: {data[:200]}")

    body_start = data.index(sep) + 4
    raw_body = data[body_start:]
    # Strip chunked encoding markers
    clean = re.sub(rb'[0-9a-f]+\r\n', b'', raw_body).replace(b'\r\n', b'')
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        return clean.decode(errors='replace')


def list_models(csrf, port):
    result = _call_raw(csrf, port, 'GetAvailableModels', {})
    if not isinstance(result, dict):
        print("Error:", result)
        return
    models = result.get('response', {}).get('models', {})
    print(f"{'Alias':<35} {'Model ID':<45} {'Provider'}")
    print("-" * 110)
    for alias, info in sorted(models.items()):
        model_id = info.get('model', '?')
        provider = info.get('apiProvider', '?').replace('API_PROVIDER_', '')
        print(f"{alias:<35} {model_id:<45} {provider}")


def ask_model(csrf, port, prompt, model_alias="gemini-2.5-flash", system=None, timeout=30):
    """Ask a model and return the response text."""
    model_id = MODEL_ALIASES.get(model_alias, model_alias)

    payload = {
        "prompt": prompt,
        "model": model_id,
    }
    if system:
        payload["systemPrompt"] = system

    result = _call_raw(csrf, port, 'GetModelResponse', payload, timeout=timeout)

    if isinstance(result, dict):
        if 'response' in result:
            return result['response']
        elif 'code' in result:
            raise RuntimeError(f"API error: {result.get('message', result)}")
    return str(result)


def main():
    parser = argparse.ArgumentParser(description='Ask AI models via Antigravity language server')
    parser.add_argument('prompt', nargs='?', help='Prompt to send to the model')
    parser.add_argument('--model', '-m', default='gemini-2.5-flash',
                        help='Model alias (default: gemini-2.5-flash)')
    parser.add_argument('--system', '-s', help='System prompt')
    parser.add_argument('--list-models', '-l', action='store_true', help='List available models')
    parser.add_argument('--timeout', '-t', type=int, default=30, help='Timeout in seconds')
    parser.add_argument('--json', action='store_true', help='Output as JSON')

    args = parser.parse_args()

    try:
        csrf, port = get_ls_connection()
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    if args.list_models:
        list_models(csrf, port)
        return

    if not args.prompt:
        # Read from stdin
        if not sys.stdin.isatty():
            args.prompt = sys.stdin.read().strip()
        else:
            parser.print_help()
            sys.exit(1)

    try:
        response = ask_model(csrf, port, args.prompt, args.model, args.system, args.timeout)
        if args.json:
            print(json.dumps({"model": args.model, "response": response}))
        else:
            print(response)
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
