#!/usr/bin/env bash
# Link every skill in this repo into the folders each local harness reads, and put `subagent` on PATH.
#
#   ~/.claude/skills/<name>  -> Claude Code (OpenCode also reads it)
#   ~/.agents/skills/<name>  -> Codex, OpenCode, DeepSeek harness
#   ~/.local/bin/subagent    -> the dispatch CLI
#
# Anything already at a target is moved to a timestamped backup, never deleted.
# Usage: ./install.sh [--dry-run] [--uninstall]
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DATA="${AGENT_SKILLS_DATA:-$HOME/.local/share/agent-skills}"
BIN_DIR="${AGENT_SKILLS_BIN:-$HOME/.local/bin}"
TARGETS=("$HOME/.claude/skills" "$HOME/.agents/skills")
CODEX_SKILLS="${CODEX_HOME:-$HOME/.codex}/skills"
TOURS_HOME="$DATA/explain-codebase"
BACKUP="$DATA/backups/$(date -u +%Y%m%dT%H%M%SZ)"

DRY=0
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
do_() { if [ "$DRY" = 1 ]; then say "  would: $*"; else "$@"; fi; }

points_into_repo() { # true when $1 is a symlink whose (absolute) target is inside this repo
  [ -L "$1" ] || return 1
  case "$(readlink "$1")" in "$REPO"/*) return 0 ;; *) return 1 ;; esac
}

backup() { # move $1 into the backup folder under label $2
  local src="$1" label="$2"
  do_ mkdir -p "$BACKUP/$label"
  do_ mv "$src" "$BACKUP/$label/"
  say "  backed up $src -> $BACKUP/$label/$(basename "$src")"
}

# Copy private codebase tours out of an old explain-codebase folder before it is backed up.
rescue_tours() {
  local old="$1/tours"
  [ -d "$old" ] && [ ! -L "$1" ] || return 0
  do_ mkdir -p "$TOURS_HOME/tours"
  for tour in "$old"/*/; do
    [ -d "$tour" ] || continue
    local name
    name="$(basename "$tour")"
    if [ -e "$TOURS_HOME/tours/$name" ]; then
      say "  tour $name already in $TOURS_HOME/tours (kept that copy)"
    else
      do_ cp -Rp "$tour" "$TOURS_HOME/tours/$name"
      say "  copied tour $name -> $TOURS_HOME/tours/$name"
    fi
  done
}

link() { # link $1 at path $2, backing up whatever is there
  local src="$1" dest="$2" label="$3"
  if points_into_repo "$dest" && [ "$(readlink "$dest")" = "$src" ]; then
    say "  ok      $dest"
    return
  fi
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    [ "$(basename "$dest")" = "explain-codebase" ] && rescue_tours "$dest"
    backup "$dest" "$label"
  fi
  do_ mkdir -p "$(dirname "$dest")"
  do_ ln -s "$src" "$dest"
  say "  linked  $dest -> $src"
}

unlink_if_ours() {
  if points_into_repo "$1"; then do_ rm "$1"; say "  removed $1"; fi
}

SKILLS=()
for d in "$REPO"/skills/*/; do
  [ -f "$d/SKILL.md" ] && SKILLS+=("$(basename "$d")")
done

if [ "$UNINSTALL" = 1 ]; then
  say "Removing links that point into $REPO"
  for t in "${TARGETS[@]}"; do for s in "${SKILLS[@]}"; do unlink_if_ours "$t/$s"; done; done
  unlink_if_ours "$BIN_DIR/subagent"
  unlink_if_ours "$TOURS_HOME/share_lint.py"
  say "Backups from earlier installs stay in $DATA/backups."
  exit 0
fi

say "Installing ${#SKILLS[@]} skills from $REPO"
for t in "${TARGETS[@]}"; do
  label="$(basename "$(dirname "$t")" | tr -d .)"
  say "$t"
  for s in "${SKILLS[@]}"; do link "$REPO/skills/$s" "$t/$s" "$label"; done
done

# Codex reads ~/.agents/skills and $CODEX_HOME/skills; a copy in both shows the skill twice.
if [ -d "$CODEX_SKILLS" ]; then
  say "$CODEX_SKILLS (duplicates only)"
  for s in "${SKILLS[@]}"; do
    if [ -e "$CODEX_SKILLS/$s" ] || [ -L "$CODEX_SKILLS/$s" ]; then backup "$CODEX_SKILLS/$s" codex; fi
  done
fi

say "CLI and tour support"
link "$REPO/bin/subagent" "$BIN_DIR/subagent" bin
do_ mkdir -p "$TOURS_HOME/tours"
link "$REPO/skills/explain-codebase/share_lint.py" "$TOURS_HOME/share_lint.py" tours

case ":$PATH:" in *":$BIN_DIR:"*) ;; *) say "note: $BIN_DIR is not on PATH; add it to use \`subagent\`." ;; esac
[ -d "$BACKUP" ] && say "Backups: $BACKUP"
say "Done. Check with: subagent doctor"
