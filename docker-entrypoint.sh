#!/bin/sh
set -e

# Remove stale chromium singleton locks from previous container runs.
# These persist in the mounted .wwebjs_auth volume after ungraceful shutdown
# and block puppeteer from launching the browser.
find /app/.wwebjs_auth -name 'Singleton*' -delete 2>/dev/null || true
find /app/.wwebjs_auth -name '*.lock' -delete 2>/dev/null || true

exec node dist/index.js
