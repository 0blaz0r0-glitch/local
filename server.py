#!/usr/bin/env python3
"""
Мини-сайт для проверки работы по локальной сети.

Запуск:
    python3 server.py [--port 8000] [--host 0.0.0.0]

После запуска откройте в браузере:
    http://<IP-адрес-этой-машины>:8000/

Зависимости: только стандартная библиотека Python 3.7+.
"""

import argparse
import json
import os
import platform
import socket
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

START_TIME = time.time()
REQUEST_COUNT = 0
_lock = threading.Lock()


def get_local_ips():
    """Собирает локальные IP-адреса машины."""
    ips = set()
    # Основной исходящий IP (без реального отправки пакетов)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    ips.add("127.0.0.1")
    return sorted(ips)


class Handler(BaseHTTPRequestHandler):
    server_version = "LANCheckMini/1.0"

    def _send(self, code, body, content_type="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        global REQUEST_COUNT
        with _lock:
            REQUEST_COUNT += 1

        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/api/ping":
            payload = {
                "status": "ok",
                "time": datetime.now().isoformat(timespec="seconds"),
                "server_time_unix": time.time(),
                "client_ip": self.client_address[0],
                "requests_total": REQUEST_COUNT,
            }
            self._send(200, json.dumps(payload))
            return

        if path == "/api/info":
            uptime = time.time() - START_TIME
            payload = {
                "hostname": socket.gethostname(),
                "platform": platform.platform(),
                "python": platform.python_version(),
                "local_ips": get_local_ips(),
                "port": self.server.server_address[1],
                "uptime_seconds": round(uptime, 1),
                "requests_total": REQUEST_COUNT,
                "start_time": datetime.fromtimestamp(START_TIME).isoformat(timespec="seconds"),
            }
            self._send(200, json.dumps(payload, ensure_ascii=False))
            return

        if path == "/api/download":
            # Тест пропускной способности: отдаём псевдослучайные данные заданного размера
            try:
                size = int(query.get("size", ["1048576"])[0])
            except ValueError:
                size = 1048576
            size = max(1024, min(size, 50 * 1024 * 1024))  # от 1 КБ до 50 МБ
            chunk = os.urandom(64 * 1024)
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(size))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            sent = 0
            while sent < size:
                part = chunk[: min(len(chunk), size - sent)]
                self.wfile.write(part)
                sent += len(part)
            return

        if path == "/api/probe":
            # Проверка доступности другого хоста:порта в локальной сети (TCP connect)
            host = (query.get("host") or [""])[0].strip()
            try:
                port = int((query.get("port") or ["80"])[0])
            except ValueError:
                port = 80
            if not host or not (1 <= port <= 65535):
                self._send(400, json.dumps(
                    {"reachable": False, "error": "некорректные host/port"}, ensure_ascii=False))
                return
            t0 = time.perf_counter()
            try:
                s = socket.create_connection((host, port), timeout=3)
                s.close()
                elapsed_ms = (time.perf_counter() - t0) * 1000
                self._send(200, json.dumps(
                    {"reachable": True, "time_ms": elapsed_ms,
                     "resolved_ip": socket.gethostbyname(host)}))
            except OSError as e:
                elapsed_ms = (time.perf_counter() - t0) * 1000
                self._send(200, json.dumps(
                    {"reachable": False, "time_ms": elapsed_ms,
                     "error": str(e)}, ensure_ascii=False))
            return

        # Статика
        if path == "/" or path == "/index.html":
            path = "/index.html"
        file_path = os.path.normpath(os.path.join(STATIC_DIR, path.lstrip("/")))
        if not file_path.startswith(STATIC_DIR) or not os.path.isfile(file_path):
            self._send(404, "Не найдено", content_type="text/plain; charset=utf-8")
            return

        ext = os.path.splitext(file_path)[1].lower()
        types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
        }
        ctype = types.get(ext, "application/octet-stream")
        with open(file_path, "rb") as f:
            self._send(200, f.read(), content_type=ctype)

    def log_message(self, fmt, *args):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] "
              f"{self.client_address[0]} - {fmt % args}")


def main():
    parser = argparse.ArgumentParser(description="Мини-сайт проверки локальной сети")
    parser.add_argument("--host", default="0.0.0.0", help="Адрес привязки (по умолчанию 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Порт (по умолчанию 8000)")
    args = parser.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)

    ips = get_local_ips()
    print("=" * 60)
    print("  Мини-сайт проверки локальной сети запущен")
    print("=" * 60)
    print(f"  Локально:        http://localhost:{args.port}/")
    for ip in ips:
        if ip != "127.0.0.1":
            print(f"  По сети:         http://{ip}:{args.port}/")
    print("-" * 60)
    print("  API:")
    print(f"    GET /api/ping   — проверка доступности (latency)")
    print(f"    GET /api/info   — информация о сервере и сети")
    print("-" * 60)
    print("  Остановка: Ctrl+C")
    print("=" * 60)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер остановлен.")
        httpd.server_close()


if __name__ == "__main__":
    main()
