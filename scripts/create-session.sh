#!/bin/sh
set -eu

session_id="${1:?usage: scripts/create-session.sh RT-YYYY-NNN [architecture-mode]}"
architecture_mode="${2:-unspecified}"

case "$session_id" in
  RT-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9]) ;;
  *) printf 'Invalid session ID: expected RT-YYYY-NNN\n' >&2; exit 2 ;;
esac

directory="results/sessions/$session_id"
if [ -e "$directory/session.yaml" ]; then
  printf 'Session already exists: %s\n' "$directory" >&2
  exit 3
fi

mkdir -p "$directory"
commit="$(git rev-parse HEAD 2>/dev/null || printf unknown)"
created="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

sed \
  -e "s|@SESSION_ID@|$session_id|g" \
  -e "s|@CREATED@|$created|g" \
  -e "s|@COMMIT@|$commit|g" \
  -e "s|@ARCHITECTURE_MODE@|$architecture_mode|g" \
  config/session-template.yaml > "$directory/session.yaml"

printf 'Created %s; review its scope and component versions before running.\n' "$directory/session.yaml"
