"""
Smart Agriculture Monitor — CORS Proxy Server
Lightweight proxy that forwards /api/* requests to the cloud platform
and serves static files for the web app.

Usage: python proxy-server.py
Access: http://localhost:3000
"""

import http.server
import urllib.request
import urllib.parse
import json
import os
import mimetypes
from urllib.parse import urljoin

PORT = 3000
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TARGET_BASE = "http://www.0531yun.com"
DATA_DIR = os.path.join(STATIC_DIR, "server-data")
APP_STATE_FILE = os.path.join(DATA_DIR, "app-state.json")


def default_app_state():
    return {
        "locations": [],
        "devices": [],
        "automations": [],
        "autoLog": [],
        "history": {},
    }


def read_app_state():
    if not os.path.isfile(APP_STATE_FILE):
        state = default_app_state()
        write_app_state(state)
        return state
    try:
        with open(APP_STATE_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        data = default_app_state()
    merged = default_app_state()
    merged.update(data if isinstance(data, dict) else {})
    return merged


def write_app_state(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    merged = default_app_state()
    merged.update(data if isinstance(data, dict) else {})
    with open(APP_STATE_FILE, "w", encoding="utf-8") as fh:
        json.dump(merged, fh, ensure_ascii=False, indent=2)


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Color-coded logging
        msg = format % args
        if '/api/' in msg:
            print(f"  \033[36m[PROXY]\033[0m {msg}")
        else:
            print(f"  \033[90m[STATIC]\033[0m {msg}")

    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'authorization, content-type, x-target-base')

    def _resolve_target_base(self):
        target_base = (self.headers.get('x-target-base') or DEFAULT_TARGET_BASE).strip()
        if not target_base.startswith(('http://', 'https://')):
            target_base = DEFAULT_TARGET_BASE
        if not target_base.endswith('/'):
            target_base += '/'
        return target_base

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/v1/health":
            self._send_json(200, {
                "ok": True,
                "message": "server storage ready",
                "storage": APP_STATE_FILE,
            })
            return

        if parsed.path == "/api/v1/app-state":
            self._send_json(200, read_app_state())
            return

        # Proxy API requests: /proxy/api/* -> cloud platform
        if parsed.path.startswith('/proxy/'):
            self._proxy_request(parsed)
            return

        # Serve static files
        self._serve_static(parsed.path)

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/v1/app-state":
            payload = self._read_json_body()
            if payload is None:
                self._send_json(400, {"code": -1, "message": "Invalid JSON body"})
                return
            write_app_state(payload)
            self._send_json(200, {"ok": True})
            return
        self.send_error(404)

    def _read_json_body(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_length) if content_length > 0 else b"{}"
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return None

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def _proxy_request(self, parsed):
        # Strip /proxy prefix, forward to cloud platform
        api_path = parsed.path[len('/proxy'):]
        target_base = self._resolve_target_base()
        target_url = urljoin(target_base, api_path.lstrip('/'))
        if parsed.query:
            target_url += f"?{parsed.query}"

        try:
            req = urllib.request.Request(target_url)
            req.add_header('User-Agent', 'AgriMonitor/1.0')

            # Forward authorization header if present
            auth = self.headers.get('authorization')
            if auth:
                req.add_header('authorization', auth)

            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self._send_cors_headers()
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', len(data))
                self.end_headers()
                self.wfile.write(data)

        except urllib.error.HTTPError as e:
            body = e.read()
            self.send_response(e.code)
            self._send_cors_headers()
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(body)

        except Exception as e:
            error_msg = json.dumps({"code": -1, "message": f"Proxy error: {str(e)}"}).encode('utf-8')
            self.send_response(502)
            self._send_cors_headers()
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(error_msg)

    def _serve_static(self, path):
        if path == '/':
            path = '/index.html'

        filepath = os.path.join(STATIC_DIR, path.lstrip('/'))
        filepath = os.path.normpath(filepath)

        # Security: prevent directory traversal
        if not filepath.startswith(STATIC_DIR):
            self.send_error(403)
            return

        if not os.path.isfile(filepath):
            self.send_error(404)
            return

        content_type, _ = mimetypes.guess_type(filepath)
        if content_type is None:
            content_type = 'application/octet-stream'

        with open(filepath, 'rb') as f:
            data = f.read()

        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', len(data))
        self.end_headers()
        self.wfile.write(data)


if __name__ == '__main__':
    read_app_state()
    server = http.server.HTTPServer(('0.0.0.0', PORT), ProxyHandler)
    print(f"""
╔══════════════════════════════════════════════╗
║   🌾 智慧农业监测平台 — 代理服务器            ║
║                                              ║
║   本地访问: http://localhost:{PORT}             ║
║   API代理:  /proxy/api/* → www.0531yun.com   ║
║                                              ║
║   按 Ctrl+C 停止服务器                        ║
╚══════════════════════════════════════════════╝
""")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止。")
        server.server_close()
