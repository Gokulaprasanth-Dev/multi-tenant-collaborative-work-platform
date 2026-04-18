#!/usr/bin/env bash
# cdebug — Logs-first debug launcher
# Usage: cdebug "describe the bug"
# Pre-loads logs + git context before invoking Claude

set -euo pipefail

if [[ -z "${1:-}" ]]; then
  echo "Usage: cdebug \"describe the bug\""
  exit 1
fi

echo "=== cdebug: collecting context ==="

CONTEXT=""

# Auto-detect log files
for LOGFILE in \
  app.log error.log server.log combined.log \
  logs/app.log logs/error.log logs/combined.log \
  dist/logs/app.log .logs/app.log; do
  if [[ -f "$LOGFILE" ]]; then
    echo "  + $LOGFILE"
    CONTEXT+="
=== $LOGFILE (last 100 lines) ===
$(tail -100 "$LOGFILE")
"
  fi
done

# Recent git changes
CONTEXT+="
=== Recent commits ===
$(git log --oneline -10 2>/dev/null || echo 'not a git repo')

=== Changed files (last commit) ===
$(git diff HEAD~1 --name-only 2>/dev/null || echo 'none')
"

# Package scripts (helps Claude understand run commands)
if [[ -f "package.json" ]]; then
  CONTEXT+="
=== package.json scripts ===
$(node -e "const p=require('./package.json'); Object.entries(p.scripts||{}).forEach(([k,v])=>console.log(k+': '+v))" 2>/dev/null || cat package.json | grep -A 30 '"scripts"')
"
fi

# SESSION.md if exists
if [[ -f "SESSION.md" ]]; then
  CONTEXT+="
=== SESSION.md (current state) ===
$(cat SESSION.md)
"
fi

if [[ -z "$CONTEXT" ]]; then
  echo "  No log files found — git context only"
fi

PROMPT="$CONTEXT

=== BUG REPORT ===
$1

Follow the Debugging Protocol strictly:
1. State your hypothesis — what you believe is wrong and why
2. Identify the minimal reproduction path from the logs above
3. Confirm root cause with evidence (quote the relevant log lines)
4. Only then write the fix
5. After fixing, verify the original symptom is gone

Do NOT touch any code until step 3 is complete."

echo "=== cdebug: launching Claude ==="
claude "$PROMPT"
