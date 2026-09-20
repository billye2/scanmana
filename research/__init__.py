"""Scanmana research layer.

Six batch jobs (outcomes, sweep, clusters, splits, breadth, replay) that read
the tables the nightly TypeScript scan fills and write research_* tables back.
Entry points: api/research_job.py (Vercel function) and `python -m research.run`.
"""
