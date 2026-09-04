#!/usr/bin/env sh
# Keep this workspace's two long-lived processes up: the daemon bridge and the
# dev server.
#
# Both die quietly. A killed terminal takes them down, and so does a crash; the
# window then shows an app that loads but never moves, or no app at all, and
# nothing in the UI says which of the two went. This watches the ports and
# starts back whichever stopped answering.
#
# It adopts what is already running rather than restarting it, so starting this
# while the pair is up disturbs nothing.
#
#   npm run resident          # supervise in the foreground, ^C to stop
#   npm run resident -- -d    # ... detached, and give the shell back
#
# Ports come from the environment, because several checkouts of this app run
# side by side and each session owns a pair:
#
#   VITE_PORT (3000)  PRIME_BRIDGE_PORT (3117)
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VITE_PORT=${VITE_PORT:-3000}
BRIDGE_PORT=${PRIME_BRIDGE_PORT:-3117}
LOGS="${HOME}/.prime/desktop/logs"
mkdir -p "$LOGS"

if [ "${1:-}" = "-d" ]; then
  # Detach: the supervisor outlives the shell that started it, which is the
  # whole point — a terminal closing must not take the app with it.
  VITE_PORT=$VITE_PORT PRIME_BRIDGE_PORT=$BRIDGE_PORT \
    setsid nohup "$0" >> "$LOGS/resident.log" 2>&1 < /dev/null &
  echo "resident: supervising in the background · $LOGS/resident.log"
  exit 0
fi

say() { echo "[resident $(date '+%H:%M:%S')] $*"; }

# The runtime refuses to start on anything older than Node 22.8, and the bridge
# hands its own interpreter to the daemon it spawns (process.execPath) — so the
# Node this script starts the bridge with is the Node the whole runtime gets.
# The box's default `node` can be older, and nothing says so until the daemon
# actually has to be spawned: every attach before that reuses one already up,
# which is how a box runs for hours looking fine and then cannot start at all.
node_ok() {
  [ -x "$1" ] || return 1
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=8)?0:1)' 2>/dev/null
}
NODE=${PRIME_NODE:-}
if ! node_ok "$NODE"; then
  NODE=""
  for candidate in "$(command -v node || true)" "$HOME/.local/node22/bin/node" /usr/local/node22/bin/node; do
    if node_ok "$candidate"; then NODE=$candidate; break; fi
  done
fi
if [ -z "$NODE" ]; then
  say "no Node 22.8+ found — the daemon cannot start. Set PRIME_NODE to one."
  exit 1
fi
say "node $("$NODE" -v) at $NODE"

# Answering HTTP, not merely holding the socket: a process that is up but no
# longer serving is the case this is here for.
alive() { curl -sf -m 2 -o /dev/null "$1"; }

start_bridge() {
  say "bridge down — starting on $BRIDGE_PORT"
  ( cd "$ROOT" && PRIME_BRIDGE_PORT=$BRIDGE_PORT "$NODE" electron/bridge.mjs \
      >> "$LOGS/bridge.$BRIDGE_PORT.log" 2>&1 & )
}

start_vite() {
  say "dev server down — starting on $VITE_PORT"
  # --strictPort: a dev server that silently moves to another port is a window
  # pointed at nothing, which is how this one went missing in the first place.
  ( cd "$ROOT" && PRIME_BRIDGE_PORT=$BRIDGE_PORT \
      ./node_modules/.bin/vite --port "$VITE_PORT" --strictPort --host \
      >> "$LOGS/vite.$VITE_PORT.log" 2>&1 & )
}

say "watching bridge :$BRIDGE_PORT and dev server :$VITE_PORT (logs in $LOGS)"
while :; do
  alive "http://127.0.0.1:$BRIDGE_PORT/bridge/health" || start_bridge
  alive "http://127.0.0.1:$VITE_PORT/" || start_vite
  sleep 5
done
