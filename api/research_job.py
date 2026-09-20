"""Vercel Python function: POST/GET /api/research_job

Runs the research jobs (research/run.py) against Neon. Called by the Next.js
cron route after the nightly scan and by POST /api/research/run (the Refresh
button). Auth: `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set
(production); preview deployments have no CRON_SECRET and rely on Vercel's
deployment protection. The path is listed in lib/auth.ts PUBLIC_PATHS so the
Clerk proxy does not intercept it.

Query: job=a,b (subset), force=1, budget=<seconds, ≤ 280>.
"""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from research.run import run_jobs  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self._run()

    def do_POST(self) -> None:
        self._run()

    def _send(self, status: int, body: dict) -> None:
        data = json.dumps(body, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _run(self) -> None:
        secret = os.environ.get("CRON_SECRET")
        if secret and self.headers.get("authorization") != f"Bearer {secret}":
            self._send(401, {"error": "unauthorized"})
            return
        q = parse_qs(urlparse(self.path).query)
        jobs = [j for j in q.get("job", [""])[0].split(",") if j] or None
        force = q.get("force", ["0"])[0] == "1"
        try:
            budget = min(280.0, float(q.get("budget", ["250"])[0]))
        except ValueError:
            budget = 250.0
        try:
            self._send(200, run_jobs(jobs, force, budget))
        except Exception as err:  # connection/env errors — report, don't 502 silently
            self._send(500, {"error": f"{type(err).__name__}: {err}"})

    def log_message(self, fmt: str, *args) -> None:  # keep Vercel logs to one line per request
        sys.stdout.write("research_job " + (fmt % args) + "\n")
