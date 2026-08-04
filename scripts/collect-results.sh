#!/bin/sh
set -eu

namespace="${NAMESPACE:-redteam}"
session_id="${SESSION_ID:-${1:-}}"
if [ -z "$session_id" ]; then
  printf 'Set SESSION_ID=RT-YYYY-NNN or pass the session ID as the first argument.\n' >&2
  exit 2
fi
case "$session_id" in
  RT-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9]) ;;
  *) printf 'Invalid session ID: expected RT-YYYY-NNN\n' >&2; exit 2 ;;
esac
destination="results/sessions/$session_id"
pod=claw-redteam-results

if [ ! -f "$destination/session.yaml" ]; then
  printf 'Missing %s/session.yaml; run scripts/create-session.sh first.\n' "$destination" >&2
  exit 3
fi
if [ -e "$destination/results.json" ]; then
  printf 'Session evidence already exists at %s; create a new session ID.\n' "$destination" >&2
  exit 4
fi
cleanup() {
  oc delete pod "$pod" -n "$namespace" --ignore-not-found >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

oc apply -n "$namespace" -f manifests/results-reader.yaml
oc wait -n "$namespace" --for=condition=Ready "pod/$pod" --timeout=90s
oc cp "$namespace/$pod:/results/results.json" "$destination/results.json"
oc cp "$namespace/$pod:/results/redteam.yaml" "$destination/redteam.yaml"
SESSION_ID="$session_id" ARCHITECTURE_MODE="${ARCHITECTURE_MODE:-not recorded}" \
  node scripts/render-report.mjs "$destination/results.json" "$destination/report.md"
node scripts/create-session-report.mjs "$destination/results.json"
(
  cd "$destination"
  sha256sum session.yaml results.json redteam.yaml report.md lessons-learned.draft.md > SHA256SUMS
)
printf 'Results copied to %s\n' "$destination"
