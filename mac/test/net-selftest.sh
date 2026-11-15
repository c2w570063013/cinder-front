#!/bin/bash
# Two-instance test of window.cinderNative.net on one Mac, without the TypeScript net module.
#
#   mac/test/net-selftest.sh [path/to/CinderFront.app]
#
# Starts a host instance and a joining instance of the same bundle (`open -n`, so each is its own app as
# far as macOS privacy is concerned), lets them exchange a few hundred messages both ways (ordering, a
# ~1 MiB frame, non-ASCII / hostile text, oversize refusal), closes cleanly, reconnects, then kill -9's the
# host and checks that the joiner gets 'closed' and 'lost'. Prints both result JSONs and a verdict.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="${1:-$ROOT/build/CinderFront.app}"
BIN="$APP/Contents/MacOS/CinderFront"
[ -x "$BIN" ] || { echo "no app at $APP — run mac/build.sh" >&2; exit 1; }
WORK="$(mktemp -d "${TMPDIR:-/tmp}/cinder-net-test.XXXXXX")"
TOKEN="t$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
for role in host join; do
  { cat "$ROOT/mac/test/net-common.js"; cat "$ROOT/mac/test/net-$role.js"; } | sed "s/__TOKEN__/$TOKEN/g" > "$WORK/$role.js"
done
cleanup() { pkill -9 -f "$WORK/" 2>/dev/null || true; }
trap cleanup EXIT

echo "work dir: $WORK  token: $TOKEN"
open -n --stdout "$WORK/host.out" --stderr "$WORK/host.err" "$APP" --args --selftest --eval "$WORK/host.js" --out "$WORK/host.json"
sleep 1.5
open -n --stdout "$WORK/join.out" --stderr "$WORK/join.err" "$APP" --args --selftest --eval "$WORK/join.js" --out "$WORK/join.json"

# Wait for the host to ask for its own death, then kill it the hard way.
for _ in $(seq 1 1200); do
  if grep -q READY_TO_KILL "$WORK/host.err" 2>/dev/null; then break; fi
  if [ -f "$WORK/join.json" ] || [ -f "$WORK/host.json" ]; then break; fi
  sleep 0.1
done
KILL_AT=""
if grep -q READY_TO_KILL "$WORK/host.err" 2>/dev/null; then
  HOST_PID="$(pgrep -f "$WORK/host.js" | head -1)"
  KILL_AT="$(python3 -c 'import time; print(int(time.time()*1000))')"
  kill -9 "$HOST_PID"
  echo "killed host pid $HOST_PID at $KILL_AT"
fi
for _ in $(seq 1 600); do [ -f "$WORK/join.json" ] && break; sleep 0.1; done

echo "── host stderr"; grep -v '^$' "$WORK/host.err" | sed 's/^/  /' | cut -c1-300 || true
echo "── join stderr"; grep -v '^$' "$WORK/join.err" | sed 's/^/  /' | cut -c1-300 || true
echo "── join result"
[ -f "$WORK/join.json" ] || { echo "no join result"; exit 1; }
KILL_AT="$KILL_AT" python3 - "$WORK/join.json" <<'PY'
import json, os, sys
r = json.load(open(sys.argv[1]))
if 'eval' not in r:
    print(json.dumps(r, ensure_ascii=False, indent=1)[:3000]); sys.exit(1)
e = r['eval']
kill_at = os.environ.get('KILL_AT')
if kill_at and isinstance(e.get('killedClosed'), dict):
    e['closedAfterKillMs'] = e['killedClosed']['at'] - int(kill_at)
    if isinstance(e.get('lostAt'), int): e['lostAfterKillMs'] = e['lostAt'] - int(kill_at)
print(json.dumps(e, ensure_ascii=False, indent=1))
print('errors:', r.get('errors'), ' evalError:', r.get('evalError'))
ok = e.get('allOk') and not r.get('errors') and not r.get('evalError')
print('VERDICT:', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
PY
