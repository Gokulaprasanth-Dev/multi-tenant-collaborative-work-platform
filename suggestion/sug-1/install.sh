#!/usr/bin/env bash
# install.sh — One-shot setup for ~/.claude system
# Run once from the directory containing this file:
#   bash install.sh

set -euo pipefail

CLAUDE_DIR="$HOME/.claude"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Claude Code Setup ==="
echo ""

# 1. Create directory structure
echo "[1/6] Creating ~/.claude directory structure..."
mkdir -p "$CLAUDE_DIR/scripts" "$CLAUDE_DIR/templates"

# 2. Copy files
echo "[2/6] Installing files..."

# Guard: never silently overwrite an existing CLAUDE.md
if [[ -f "$CLAUDE_DIR/CLAUDE.md" ]]; then
  echo ""
  echo "  ⚠️  ~/.claude/CLAUDE.md already exists."
  echo "  Diff (existing vs new):"
  diff "$CLAUDE_DIR/CLAUDE.md" "$SCRIPT_DIR/CLAUDE.md" || true
  echo ""
  read -rp "  Overwrite ~/.claude/CLAUDE.md? [y/N] " REPLY
  if [[ "${REPLY,,}" == "y" ]]; then
    cp "$SCRIPT_DIR/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md"
    echo "  Overwritten."
  else
    echo "  Skipped — keeping existing CLAUDE.md."
  fi
else
  cp "$SCRIPT_DIR/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md"
  echo "  Copied CLAUDE.md"
fi

# Guard: skip LEARNINGS.md if it already has entries (non-empty beyond header)
if [[ -f "$CLAUDE_DIR/LEARNINGS.md" ]]; then
  echo "  LEARNINGS.md already exists — skipping (preserving existing entries)"
else
  cp "$SCRIPT_DIR/LEARNINGS.md" "$CLAUDE_DIR/LEARNINGS.md"
  echo "  Copied LEARNINGS.md"
fi
cp "$SCRIPT_DIR/scripts/cdebug.sh"      "$CLAUDE_DIR/scripts/cdebug.sh"
cp "$SCRIPT_DIR/scripts/log-learning.sh" "$CLAUDE_DIR/scripts/log-learning.sh"
cp "$SCRIPT_DIR/scripts/init-claude.sh" "$CLAUDE_DIR/scripts/init-claude.sh"
cp "$SCRIPT_DIR/templates/SPEC.md"      "$CLAUDE_DIR/templates/SPEC.md"
cp "$SCRIPT_DIR/templates/SESSION.md"   "$CLAUDE_DIR/templates/SESSION.md"
cp "$SCRIPT_DIR/templates/project-CLAUDE.md" "$CLAUDE_DIR/templates/project-CLAUDE.md"

# 3. Make scripts executable
echo "[3/6] Making scripts executable..."
chmod +x "$CLAUDE_DIR/scripts/cdebug.sh"
chmod +x "$CLAUDE_DIR/scripts/log-learning.sh"
chmod +x "$CLAUDE_DIR/scripts/init-claude.sh"

# 4. Add aliases to shell rc
echo "[4/6] Adding aliases..."

ALIASES='
# Claude Code aliases
alias cdebug="$HOME/.claude/scripts/cdebug.sh"
alias log-learning="$HOME/.claude/scripts/log-learning.sh"
alias init-claude="$HOME/.claude/scripts/init-claude.sh"
# For cheap/exploratory tasks (conversation, reading, summarizing):
# claude --model claude-haiku-4-5 "your prompt"'

# Detect shell
RC_FILE="$HOME/.bashrc"
if [[ "$SHELL" == */zsh ]]; then
  RC_FILE="$HOME/.zshrc"
fi

# Only add if not already present
if ! grep -q "Claude Code aliases" "$RC_FILE" 2>/dev/null; then
  echo "$ALIASES" >> "$RC_FILE"
  echo "  Added to $RC_FILE"
else
  echo "  Aliases already present in $RC_FILE — skipping"
fi

# 5. Init git repo for ~/.claude
echo "[5/6] Initializing git repo for ~/.claude..."
if [[ ! -d "$CLAUDE_DIR/.git" ]]; then
  git -C "$CLAUDE_DIR" init -q
  git -C "$CLAUDE_DIR" add .
  git -C "$CLAUDE_DIR" commit -q -m "init: claude config system"
  echo "  Git repo initialized at ~/.claude"
else
  echo "  Git repo already exists — skipping init"
fi

# 6. Bootstrap SESSION.md in current project if in a git repo
echo "[6/6] Checking for project SESSION.md..."
if git rev-parse --git-dir > /dev/null 2>&1; then
  PROJECT_ROOT=$(git rev-parse --show-toplevel)
  if [[ ! -f "$PROJECT_ROOT/SESSION.md" ]]; then
    cp "$CLAUDE_DIR/templates/SESSION.md" "$PROJECT_ROOT/SESSION.md"
    echo "  Created SESSION.md in $PROJECT_ROOT"
    echo "  Add it to git: git add SESSION.md && git commit -m 'chore: add SESSION.md'"
  else
    echo "  SESSION.md already exists in project — skipping"
  fi
else
  echo "  Not in a git repo — skipping project SESSION.md"
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Aliases available after: source $RC_FILE"
echo ""
echo "  cdebug \"describe the bug\"    — logs-first debug launcher"
echo "  log-learning                  — append session insight (interactive)"
echo "  init-claude                   — scaffold new project CLAUDE.md + SESSION.md"
echo ""
echo "For your existing projects, manually add SESSION.md:"
echo "  cp ~/.claude/templates/SESSION.md <project-root>/SESSION.md"
echo "  git add SESSION.md && git commit -m 'chore: add session continuity'"
