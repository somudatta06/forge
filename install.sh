#!/usr/bin/env bash
# Forge installer. Copies Forge into ~/.claude and wires up the hook.
# Works for the Claude Code CLI and the desktop app (both use ~/.claude).
# Safe to run again: it merges the hook into settings.json without touching your other settings.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

echo "==> Installing Forge into $CLAUDE_DIR"

# 1. Files
mkdir -p "$CLAUDE_DIR/skills/forge" "$CLAUDE_DIR/workflows" "$CLAUDE_DIR/hooks"
cp "$HERE/skill/SKILL.md"          "$CLAUDE_DIR/skills/forge/SKILL.md"
cp "$HERE/workflow/forge-swarm.js" "$CLAUDE_DIR/workflows/forge-swarm.js"
cp "$HERE/hooks/forge-inject.py"   "$CLAUDE_DIR/hooks/forge-inject.py"
cp "$HERE/hooks/forge-models.py"   "$CLAUDE_DIR/hooks/forge-models.py"
chmod +x "$CLAUDE_DIR/hooks/forge-inject.py" "$CLAUDE_DIR/hooks/forge-models.py"
echo "    - skill, workflow, and hooks copied"

# 2. Model config for this machine
python3 "$CLAUDE_DIR/hooks/forge-models.py" >/dev/null 2>&1 \
  && echo "    - model config generated (~/.claude/forge-models.json)" \
  || echo "    - model config skipped; Forge will use its built-in defaults"

# 3. Add the hook to settings.json (create the file if missing, keep everything else)
python3 - "$CLAUDE_DIR/settings.json" <<'PY'
import json, sys
path = sys.argv[1]
try:
    with open(path) as f:
        cfg = json.load(f)
except (FileNotFoundError, ValueError):
    cfg = {}

cmd = 'python3 "$HOME/.claude/hooks/forge-inject.py"'
ups = cfg.setdefault("hooks", {}).setdefault("UserPromptSubmit", [])
present = any(
    h.get("command") == cmd
    for g in ups if isinstance(g, dict)
    for h in g.get("hooks", []) if isinstance(h, dict)
)
if not present:
    ups.append({"hooks": [{"type": "command", "command": cmd}]})
    with open(path, "w") as f:
        json.dump(cfg, f, indent=2)
    print("    - settings.json: hook added")
else:
    print("    - settings.json: hook already present")
PY

echo
echo "==> Done. Quit and reopen Claude Code so it loads the hook."
echo "    Skip one message: start it with 'raw:'"
echo "    Turn off:  touch ~/.claude/forge.off      Turn on:  rm ~/.claude/forge.off"
echo "    Refresh model list:  python3 ~/.claude/hooks/forge-models.py"
