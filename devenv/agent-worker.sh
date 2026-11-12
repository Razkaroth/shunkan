#!/usr/bin/env bash
# Cursor My Machines worker for this worktree (via `dev agent …`).
# Uses a separate PM2 home (/tmp/shunkan.<branch>-agent) so `dev stop` cannot kill it.
#
# The PM2 process is this supervisor, not a raw `agent worker`. Cursor's CLI
# stays up across link drops and reconnects, so PM2 would otherwise stay
# "online" while the remote worker is gone. We scrape the management
# `/metrics` gauge and exit 75 when the link is confirmed down. PM2
# autorestart (no stop_exit_codes) starts a new worker instead of leaving
# the dead one online.
set -euo pipefail

CMD=${1:-}
[ -n "$CMD" ] || {
  printf 'usage: devenv/agent-worker.sh start|stop|restart|status|logs|print|run\n' >&2
  exit 1
}
shift

root=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ -n "$root" ] || {
  printf 'dev agent: not inside a git worktree\n' >&2
  exit 1
}
cd "$root"

# shellcheck source=./agent-worker-lib.sh
. "$root/devenv/agent-worker-lib.sh"

# One application. The label is always shunkan. The reported worker name is
# shunkan-<branch> from nordic_worker_name. Ignore any inherited app pin.
APP_NAME=shunkan
export APP_NAME

NORDIC_CMD="dev agent"
die() {
  printf '%s: %s\n' "$NORDIC_CMD" "$*" >&2
  exit 1
}

# EX_TEMPFAIL. Not listed in PM2 stop_exit_codes, so autorestart brings it back.
NORDIC_WORKER_DISCONNECT_EXIT=75

# shellcheck source=./pm2-home.sh
. "$root/devenv/pm2-home.sh"
nordic_pm2_export_agent_home || die "could not derive PM2_HOME from the current branch"
# Per-worktree Cursor data dir — the CLI locks $dataDir/worker.lock globally per
# path. Without this, a second worktree fails with "another worker daemon is
# already running for this data dir: ~/.local/share/cursor-agent/worker.lock".
WORKER_DATA_DIR="${NORDIC_WORKER_DATA_DIR:-${root}/.cursor-worker}"
PROCESS_NAME=cursor-worker
child=

nordic_worker_branch() {
  local branch
  branch=$(git branch --show-current 2>/dev/null || true)
  if [ -z "$branch" ]; then
    die "detached HEAD — check out a named branch before starting the worker"
  fi
  printf '%s' "$branch"
}

nordic_worker_resolve() {
  BRANCH=$(nordic_worker_branch)
  WORKER_NAME=$(nordic_worker_name "$BRANCH") ||
    die "branch ${BRANCH} sanitizes to an empty worker name"
  export BRANCH WORKER_NAME
}

# True when something accepts TCP on 127.0.0.1:$1.
nordic_worker_port_open() {
  local port=$1
  (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1
}

# Pick the localhost port for `agent worker --management-addr`.
# Pass "persist" to record it at $WORKER_DATA_DIR/management.port.
nordic_worker_mgmt_port() {
  local persist=${1:-}
  local port=""
  if [ -n "${NORDIC_WORKER_MGMT_PORT:-}" ]; then
    port=$NORDIC_WORKER_MGMT_PORT
  else
    local base=${NORDIC_WORKER_MGMT_PORT_BASE:-39400}
    local offset=${PORT_OFFSET:-0}
    local i candidate
    case "$offset" in
      '' | *[!0-9]*) offset=0 ;;
    esac
    for i in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19; do
      candidate=$((base + offset + i))
      if ! nordic_worker_port_open "$candidate"; then
        port=$candidate
        break
      fi
    done
    [ -n "$port" ] || die "no free management port from ${base}+${offset}"
  fi
  if [ "$persist" = "persist" ]; then
    mkdir -p "$WORKER_DATA_DIR"
    printf '%s\n' "$port" >"$WORKER_DATA_DIR/management.port"
  fi
  printf '%s' "$port"
}

nordic_worker_argv() {
  local port=${NORDIC_WORKER_MGMT_PORT:?management port}
  local bin=${NORDIC_AGENT_BIN:-agent}
  # Prints argv one arg per line (safe for mapfile).
  # Worker flags belong before `start` (Cursor CLI).
  printf '%s\n' "$bin" worker \
    --name "$WORKER_NAME" \
    --worker-dir "$root" \
    --data-dir "$WORKER_DATA_DIR" \
    --management-addr "127.0.0.1:${port}" \
    --idle-release-timeout 0 \
    --label "app=${APP_NAME}" \
    --label "branch=${BRANCH}" \
    start
}

nordic_worker_online() {
  [ -d "$PM2_HOME" ] || return 1
  command -v pm2 >/dev/null 2>&1 || return 1
  local pid
  pid=$(pm2 pid "$PROCESS_NAME" 2>/dev/null || true)
  [ -n "$pid" ] && [ "$pid" != "0" ]
}

nordic_worker_state_field() {
  local key=$1 file=$WORKER_DATA_DIR/link-state
  [ -f "$file" ] || return 1
  awk -F= -v key="$key" '
    $1 == key {
      print substr($0, index($0, "=") + 1)
      found = 1
    }
    END { exit !found }
  ' "$file"
}

nordic_worker_write_state() {
  local verdict=$1 streak=$2 connected=$3 activity=$4 detail=$5
  local tmp
  mkdir -p "$WORKER_DATA_DIR"
  tmp=$(mktemp "$WORKER_DATA_DIR/link-state.XXXXXX")
  cat >"$tmp" <<EOF
verdict=${verdict}
streak=${streak}
connected=${connected}
last_activity=${activity}
updated=$(date +%s)
detail=${detail}
EOF
  mv "$tmp" "$WORKER_DATA_DIR/link-state"
}

nordic_worker_log_disconnect() {
  local msg=$1
  printf 'dev agent: %s\n' "$msg" >&2
  mkdir -p "$WORKER_DATA_DIR"
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$msg" >>"$WORKER_DATA_DIR/disconnect.log"
}

nordic_worker_kill_child() {
  if [ -n "${child:-}" ] && kill -0 "$child" 2>/dev/null; then
    kill "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  child=
}

# Scrape /metrics and print starting|connected|disconnected.
# Uses process uptime and link-state so a startup window is not a disconnect.
nordic_worker_probe_verdict() {
  local port="" body="" connected=0 activity=0 reachable=0 now seen=0 deadline
  local etimes=0 pid="" file_verdict="" grace
  grace=${NORDIC_WORKER_STARTUP_GRACE_SEC:-60}
  now=$(date +%s)
  if [ -f "$WORKER_DATA_DIR/management.port" ]; then
    port=$(tr -d '[:space:]' <"$WORKER_DATA_DIR/management.port")
  fi
  file_verdict=$(nordic_worker_state_field verdict 2>/dev/null || true)
  if [ -n "$port" ]; then
    body=$(curl -fsS --max-time 2 "http://127.0.0.1:${port}/metrics" 2>/dev/null || true)
  fi
  if [ -n "$body" ]; then
    reachable=1
    connected=$(nordic_worker_metric_value "$body" cursor_self_hosted_worker_connected || printf '0')
    activity=$(nordic_worker_metric_value "$body" cursor_self_hosted_worker_last_activity_unix_seconds || printf '0')
  fi
  if [ "$file_verdict" = "connected" ] || [ "$file_verdict" = "disconnected" ]; then
    seen=1
  fi
  if command -v pm2 >/dev/null 2>&1; then
    pid=$(pm2 pid "$PROCESS_NAME" 2>/dev/null || true)
  fi
  if [ -n "$pid" ] && [ "$pid" != "0" ]; then
    etimes=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)
  fi
  case "$etimes" in
    '' | *[!0-9]*) etimes=0 ;;
  esac
  if [ "$etimes" -ge "$grace" ]; then
    seen=1
  fi
  deadline=$((now - etimes + grace))
  nordic_worker_liveness "$connected" "$activity" "$now" "$seen" "$deadline" "$reachable"
}

nordic_worker_recover_link() {
  local verdict connected=0 activity=0 body="" port="" reasons="" name
  verdict=$(nordic_worker_probe_verdict)
  name=${WORKER_NAME:-unknown}
  case "$verdict" in
    connected)
      printf 'dev agent: cursor link connected name=%s\n' "$name"
      ;;
    starting)
      printf 'dev agent: cursor link starting (not connected yet)\n'
      ;;
    disconnected)
      if [ -f "$WORKER_DATA_DIR/management.port" ]; then
        port=$(tr -d '[:space:]' <"$WORKER_DATA_DIR/management.port")
        body=$(curl -fsS --max-time 2 "http://127.0.0.1:${port}/metrics" 2>/dev/null || true)
      fi
      if [ -n "$body" ]; then
        connected=$(nordic_worker_metric_value "$body" cursor_self_hosted_worker_connected || printf '0')
        activity=$(nordic_worker_metric_value "$body" cursor_self_hosted_worker_last_activity_unix_seconds || printf '0')
        reasons=$(nordic_worker_session_end_summary "$body")
      fi
      nordic_worker_log_disconnect "cursor worker disconnected name=${name} connected=${connected} last_activity=${activity}${reasons:+ ${reasons}}"
      printf 'dev agent: restarting PM2 process so a dead cursor link is not left online\n'
      pm2 restart "$PROCESS_NAME" >/dev/null 2>&1 || pm2 start "$root/devenv/pm2/agent.config.cjs" >/dev/null 2>&1 || true
      ;;
  esac
}

cmd_print() {
  nordic_worker_resolve
  local port
  port=$(nordic_worker_mgmt_port)
  NORDIC_WORKER_MGMT_PORT=$port
  export NORDIC_WORKER_MGMT_PORT
  local -a argv=()
  mapfile -t argv < <(nordic_worker_argv)
  [ "${#argv[@]}" -ge 2 ] || die "could not build the worker command"
  printf 'dev agent: would run (PM2_HOME=%s):\n' "$PM2_HOME"
  printf '  %q' "${argv[@]}"
  printf '\n'
}

cmd_run() {
  # Invoked under PM2. Re-resolve from the current branch so a restart picks up a rename.
  nordic_worker_resolve
  local agent_bin=${NORDIC_AGENT_BIN:-agent}
  command -v "$agent_bin" >/dev/null 2>&1 || die "agent not on PATH (install Cursor CLI or enter the direnv shell)"
  command -v curl >/dev/null 2>&1 || die "curl not on PATH (needed to read worker /metrics)"

  local port
  port=$(nordic_worker_mgmt_port persist)
  NORDIC_WORKER_MGMT_PORT=$port
  export NORDIC_WORKER_MGMT_PORT
  local -a argv=()
  mapfile -t argv < <(nordic_worker_argv)
  [ "${#argv[@]}" -ge 2 ] || die "could not build the worker command"

  local poll grace need
  poll=${NORDIC_WORKER_POLL_SEC:-10}
  grace=${NORDIC_WORKER_STARTUP_GRACE_SEC:-60}
  need=${NORDIC_WORKER_DISCONNECT_POLLS:-2}

  nordic_worker_write_state starting 0 0 0 launching
  printf 'dev agent: supervising %s (app=%s branch=%s metrics=http://127.0.0.1:%s/metrics)\n' \
    "$WORKER_NAME" "$APP_NAME" "$BRANCH" "$port" >&2

  "${argv[@]}" &
  child=$!
  trap 'nordic_worker_kill_child; exit 0' INT TERM

  local start_epoch seen=0 streak=0 deadline
  start_epoch=$(date +%s)
  deadline=$((start_epoch + grace))

  while kill -0 "$child" 2>/dev/null; do
    sleep "$poll" || true
    if ! kill -0 "$child" 2>/dev/null; then
      break
    fi

    local body="" reachable=0 connected=0 activity=0 now verdict observe action reasons=""
    body=$(curl -fsS --max-time 2 "http://127.0.0.1:${port}/metrics" 2>/dev/null || true)
    if [ -n "$body" ]; then
      reachable=1
      connected=$(nordic_worker_metric_value "$body" cursor_self_hosted_worker_connected || printf '0')
      activity=$(nordic_worker_metric_value "$body" cursor_self_hosted_worker_last_activity_unix_seconds || printf '0')
    fi
    now=$(date +%s)
    verdict=$(nordic_worker_liveness "$connected" "$activity" "$now" "$seen" "$deadline" "$reachable")
    observe=$(nordic_worker_observe "$verdict" "$streak" "$need")
    streak=${observe%% *}
    action=${observe##* }
    nordic_worker_write_state "$verdict" "$streak" "$connected" "$activity" "$action"

    case "$action" in
      ok)
        if [ "$seen" = 0 ]; then
          printf 'dev agent: cursor worker connected name=%s\n' "$WORKER_NAME" >&2
        fi
        seen=1
        ;;
      wait)
        if [ "$verdict" = "disconnected" ]; then
          printf 'dev agent: cursor worker link down (%s/%s) name=%s connected=%s last_activity=%s\n' \
            "$streak" "$need" "$WORKER_NAME" "$connected" "$activity" >&2
        fi
        ;;
      exit)
        reasons=$(nordic_worker_session_end_summary "$body")
        nordic_worker_log_disconnect "cursor worker disconnected name=${WORKER_NAME} connected=${connected} last_activity=${activity}${reasons:+ ${reasons}}"
        nordic_worker_write_state disconnected "$streak" "$connected" "$activity" exited
        nordic_worker_kill_child
        exit "$NORDIC_WORKER_DISCONNECT_EXIT"
        ;;
    esac
  done

  local code=0
  if [ -n "${child:-}" ]; then
    wait "$child" || code=$?
  fi
  if [ "$code" -ne 0 ]; then
    nordic_worker_log_disconnect "agent worker process exited code=${code} name=${WORKER_NAME}"
  else
    printf 'dev agent: agent worker process exited code=0 name=%s\n' "$WORKER_NAME" >&2
  fi
  exit "$code"
}

cmd_start() {
  nordic_worker_resolve
  local agent_bin=${NORDIC_AGENT_BIN:-agent}
  command -v "$agent_bin" >/dev/null 2>&1 || die "agent not on PATH (install Cursor CLI: curl https://cursor.com/install -fsS | bash)"
  command -v pm2 >/dev/null 2>&1 || die "pm2 not on PATH (enter the direnv/devShell)"

  if nordic_worker_online; then
    local verdict
    verdict=$(nordic_worker_probe_verdict || true)
    if [ "$verdict" = "disconnected" ]; then
      printf 'dev agent: local process is up but the cursor link is down; cycling %s\n' "$PROCESS_NAME"
      pm2 delete "$PROCESS_NAME" >/dev/null 2>&1 || true
    else
      printf 'dev agent: already online (%s) — app=%s branch=%s name=%s\n' \
        "$PROCESS_NAME" "$APP_NAME" "$BRANCH" "$WORKER_NAME"
      return 0
    fi
  fi

  mkdir -p "$PM2_HOME" "$WORKER_DATA_DIR"
  # Ensure PM2 child inherits resolved identity + current PATH (agent, bun, …).
  export APP_NAME BRANCH WORKER_NAME WORKER_DATA_DIR
  printf 'dev agent: starting %s (name=%s app=%s branch=%s data-dir=%s)\n' \
    "$PROCESS_NAME" "$WORKER_NAME" "$APP_NAME" "$BRANCH" "$WORKER_DATA_DIR"
  # Delete stale stopped entry if present, then start fresh.
  pm2 delete "$PROCESS_NAME" >/dev/null 2>&1 || true
  exec pm2 start "$root/devenv/pm2/agent.config.cjs"
}

cmd_restart() {
  nordic_worker_resolve
  command -v pm2 >/dev/null 2>&1 || die "pm2 not on PATH (enter the direnv/devShell)"
  printf 'dev agent: restarting %s (name=%s)\n' "$PROCESS_NAME" "$WORKER_NAME"
  if [ -d "$PM2_HOME" ]; then
    pm2 delete "$PROCESS_NAME" >/dev/null 2>&1 || true
  fi
  cmd_start
}

cmd_stop() {
  if [ ! -d "$PM2_HOME" ]; then
    printf 'dev agent: no PM2_HOME at %s (nothing to stop)\n' "$PM2_HOME"
    return 0
  fi
  command -v pm2 >/dev/null 2>&1 || die "pm2 not on PATH (enter the direnv/devShell)"
  printf 'dev agent: stopping worker in %s\n' "$PM2_HOME"
  pm2 delete "$PROCESS_NAME" >/dev/null 2>&1 || true
  # Leave the daemon; workspace clean kills the whole home.
  printf 'dev agent: stopped\n'
}

cmd_status() {
  if [ ! -d "$PM2_HOME" ]; then
    printf 'dev agent: not running (no %s)\n' "$PM2_HOME"
    return 0
  fi
  command -v pm2 >/dev/null 2>&1 || die "pm2 not on PATH (enter the direnv/devShell)"
  local branch name
  branch=$(git branch --show-current 2>/dev/null || true)
  if [ -n "$branch" ]; then
    name=$(nordic_worker_name "$branch" || true)
    if [ -n "$name" ]; then
      WORKER_NAME=$name
      printf 'dev agent: expected name=%s branch=%s worker-dir=%s\n' \
        "$name" "$branch" "$root"
    fi
  fi
  if nordic_worker_online; then
    nordic_worker_recover_link
  else
    if [ -f "$WORKER_DATA_DIR/disconnect.log" ]; then
      printf 'dev agent: last event: %s\n' "$(tail -n 1 "$WORKER_DATA_DIR/disconnect.log")"
    fi
    printf 'dev agent: supervisor is not online\n'
  fi
  pm2 status
}

cmd_logs() {
  command -v pm2 >/dev/null 2>&1 || die "pm2 not on PATH (enter the direnv/devShell)"
  [ -d "$PM2_HOME" ] || die "no PM2_HOME at $PM2_HOME — start with: dev agent start"
  exec pm2 logs "$PROCESS_NAME" "$@"
}

case "$CMD" in
  start) cmd_start "$@" ;;
  stop) cmd_stop "$@" ;;
  restart) cmd_restart "$@" ;;
  status) cmd_status "$@" ;;
  logs) cmd_logs "$@" ;;
  print) cmd_print "$@" ;;
  run) cmd_run "$@" ;;
  -h | --help | help)
    cat <<'EOF'
Usage: dev agent <command>

Manage a per-worktree Cursor My Machines worker (separate from dev start/stop).

  start    Start the agent worker for this worktree (a named branch is required)
  stop     Stop the worker (does not affect the app stack)
  restart  Stop the worker if it is up, then start it again
  status   Cursor link plus PM2 status. A dead link is restarted, not left online
  logs     Tail worker logs
  print    Print the agent worker argv without starting

Identity (one app; the branch is the worktree branch):
  --name            shunkan-<branch>  e.g. master → shunkan-master, Raz-edition → shunkan-Raz-edition
  --label app=      shunkan
  --label branch=   raw branch name
  --data-dir        <worktree>/.cursor-worker  (isolates worker.lock per worktree)
  --management-addr 127.0.0.1:(39400+PORT_OFFSET)  /metrics liveness

The supervisor scrapes cursor_self_hosted_worker_connected and
cursor_self_hosted_worker_last_activity_unix_seconds. Disconnects are written
to stderr (PM2 logs) and <worktree>/.cursor-worker/disconnect.log. A confirmed
drop exits 75 so PM2 autorestart brings the worker back instead of leaving
the dead link online.
EOF
    ;;
  *)
    die "unknown command: $CMD (try: start|stop|restart|status|logs|print)"
    ;;
esac
