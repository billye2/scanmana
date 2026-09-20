"""Job runner: runs the research jobs in dependency order inside a time budget.

Used by api/research_job.py (Vercel function, ≤ 300 s) and locally via
`vercel env run -e production -- python3 -m research.run [--force] [--jobs a,b]`.
A job that is already current for the latest scan date is skipped unless
--force; a job that would not fit in the remaining budget is deferred to the
next invocation (research_runs records every attempt).
"""
from __future__ import annotations

import argparse
import importlib
import json
import time
import traceback
from typing import Any

from . import util
from .db import connect

# Dependency order: sweep reads outcomes; the rest are independent.
ORDER = ["outcomes", "breadth", "splits", "clusters", "sweep", "replay"]
# Rough seconds each job needs; a job is deferred when less than this remains.
MIN_SECONDS = {"outcomes": 40, "breadth": 30, "splits": 30, "clusters": 40, "sweep": 15, "replay": 15}


def run_jobs(jobs: list[str] | None = None, force: bool = False, budget: float = 250.0) -> dict[str, Any]:
    started = time.monotonic()
    results: list[dict[str, Any]] = []
    with connect() as conn:
        scan_date = util.latest_scan_date(conn)
        if not scan_date:
            return {"error": "no scan yet", "results": results}
        ctx = util.JobContext(scan_date=scan_date, force=force, deadline=started + budget)
        for job in ORDER:
            if jobs and job not in jobs:
                continue
            t0 = time.monotonic()
            if not force and util.is_current(conn, job, scan_date):
                results.append({"job": job, "status": "current", "seconds": 0.0})
                continue
            if not ctx.has_time(MIN_SECONDS[job]):
                results.append({"job": job, "status": "deferred", "note": "out of time budget", "seconds": 0.0})
                continue
            util.mark_start(conn, job, scan_date)
            try:
                mod = importlib.import_module(f"research.{job}")
                note = mod.run(conn, ctx)
                conn.commit()
                util.mark_done(conn, job, True, note)
                results.append({"job": job, "status": "ok", "note": note, "seconds": round(time.monotonic() - t0, 1)})
            except Exception as err:  # one job's failure must not stop the others
                conn.rollback()
                note = f"{type(err).__name__}: {err}"
                traceback.print_exc()
                util.mark_done(conn, job, False, note)
                results.append({"job": job, "status": "error", "note": note, "seconds": round(time.monotonic() - t0, 1)})
    return {"scan_date": scan_date, "seconds": round(time.monotonic() - started, 1), "results": results}


def main() -> None:
    p = argparse.ArgumentParser(description="Run the Scanmana research jobs.")
    p.add_argument("--jobs", help="comma-separated subset of: " + ", ".join(ORDER))
    p.add_argument("--force", action="store_true", help="re-run jobs that are already current")
    p.add_argument("--budget", type=float, default=600.0, help="seconds")
    a = p.parse_args()
    jobs = [j.strip() for j in a.jobs.split(",")] if a.jobs else None
    print(json.dumps(run_jobs(jobs, a.force, a.budget), indent=2, default=str))


if __name__ == "__main__":
    main()
