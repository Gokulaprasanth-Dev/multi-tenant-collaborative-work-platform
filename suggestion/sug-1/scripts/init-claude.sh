#!/usr/bin/env bash
# init-claude — Scaffold a per-project CLAUDE.md from template
# Usage: init-claude (run from project root)

TEMPLATE="$HOME/.claude/templates/project-CLAUDE.md"
TARGET="$PWD/CLAUDE.md"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "Template not found at $TEMPLATE"
  exit 1
fi

if [[ -f "$TARGET" ]]; then
  echo "CLAUDE.md already exists at $TARGET"
  echo "To append session continuity rules only, run:"
  echo "  cat ~/.claude/templates/SESSION_RULE.md >> CLAUDE.md"
  exit 1
fi

PROJECT=$(basename "$PWD")
cp "$TEMPLATE" "$TARGET"
sed -i "s/\[Project Name\]/$PROJECT/g" "$TARGET"
sed -i "s/\[YYYY-MM-DD\]/$(date +%Y-%m-%d)/g" "$TARGET"

echo "✓ Created CLAUDE.md for '$PROJECT'"
echo "  Edit it to fill in: stack, key files, run commands, conventions"
echo ""
echo "  Also create SESSION.md:"
echo "  cp ~/.claude/templates/SESSION.md ./SESSION.md"
