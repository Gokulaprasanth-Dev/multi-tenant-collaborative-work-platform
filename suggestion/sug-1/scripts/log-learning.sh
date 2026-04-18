#!/usr/bin/env bash
# log-learning — Append a learning to ~/.claude/LEARNINGS.md
# Usage: log-learning "what failed" "root cause" "rule to add"
# Or:    log-learning  (interactive mode — prompts for each field)

LEARNINGS="$HOME/.claude/LEARNINGS.md"

if [[ $# -eq 3 ]]; then
  FAILED="$1"
  CAUSE="$2"
  RULE="$3"
elif [[ $# -eq 0 ]]; then
  echo "=== log-learning (interactive) ==="
  read -rp "What failed? " FAILED
  read -rp "Root cause?  " CAUSE
  read -rp "Rule to add? " RULE
else
  echo "Usage: log-learning \"what failed\" \"root cause\" \"rule to add\""
  echo "Or:    log-learning  (interactive)"
  exit 1
fi

DATE=$(date +%Y-%m-%d)
PROJECT=$(basename "$PWD")

cat >> "$LEARNINGS" << EOF

## [$DATE] $PROJECT
- **What failed:** $FAILED
- **Root cause:** $CAUSE
- **Rule to add:** $RULE
EOF

echo "✓ Logged to $LEARNINGS"
