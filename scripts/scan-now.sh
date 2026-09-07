#!/usr/bin/env bash
# Trigger the production scan by hand. Run via `npm run scan:now`, which wraps
# this in `vercel env run -e production` so CRON_SECRET is injected per-process.
set -euo pipefail
PROD_URL="${PROD_URL:-https://scanmana.vercel.app}"
FORCE="${1:-1}"

if [[ -z "${CRON_SECRET:-}" ]]; then
  cat >&2 <<MSG
CRON_SECRET is not readable here. On Vercel it is marked "Sensitive", which
makes it write-only — vercel env run cannot inject it. Two options:

  a) Trigger the scan from the Vercel dashboard (no secret needed; the first
     scan of a day doesn't need force=1):
       Project → Settings → Cron Jobs → /api/cron/scan → Run

  b) Recreate CRON_SECRET as non-sensitive so local tooling can use it, then
     redeploy:
       vercel env rm CRON_SECRET production --yes
       openssl rand -hex 32 | vercel env add CRON_SECRET production
       vercel --prod --yes
MSG
  exit 1
fi

curl -sS -H "Authorization: Bearer ${CRON_SECRET}" "${PROD_URL}/api/cron/scan?force=${FORCE}"
printf '\n'
