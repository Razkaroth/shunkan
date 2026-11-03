# Pure helpers for `dev agent` (sourced by devenv/agent-worker.sh).
# No `set -e` — callers own errexit. Safe to source from tests.

# Sanitize a branch for the worker name suffix: lowercase, [a-z0-9_-] only.
nordic_worker_slug() {
  printf '%s' "$1" |
    tr '[:upper:]' '[:lower:]' |
    tr -c 'a-z0-9_-' '-' |
    sed -E 's/-+/-/g; s/^-+//; s/-+$//'
}

# Cursor display name. Prefix is literal "Shunkan-" (repo name); the branch
# is still sanitized the way `--name` was before the prefix.
# Prints nothing and returns 1 when the branch sanitizes to empty.
nordic_worker_name() {
  local slug
  slug=$(nordic_worker_slug "$1")
  if [ -z "$slug" ]; then
    return 1
  fi
  printf 'Shunkan-%s' "$slug"
}

# Last sample of a Prometheus metric. Accepts `name` or `name{labels}`.
# Prints an integer (fractional part stripped). Returns 1 when missing.
nordic_worker_metric_value() {
  local body=$1 name=$2
  printf '%s\n' "$body" | awk -v name="$name" '
    $0 ~ /^#/ { next }
    $1 == name || index($1, name "{") == 1 { val = $NF }
    END {
      if (val == "") exit 1
      sub(/\..*/, "", val)
      if (val !~ /^-?[0-9]+$/) exit 1
      print val
    }
  '
}

# Non-zero session-end counters, e.g. "session_end_stream_error=2".
# Empty output when the body has none. Always succeeds.
nordic_worker_session_end_summary() {
  local body=$1
  printf '%s\n' "$body" | awk '
    $0 ~ /^#/ { next }
    $1 ~ /^cursor_self_hosted_worker_session_ends_total\{/ {
      reason = ""
      if (match($1, /reason="[^"]+"/)) {
        reason = substr($1, RSTART + 8, RLENGTH - 9)
      }
      count = $NF
      sub(/\..*/, "", count)
      if (reason != "" && count ~ /^[0-9]+$/ && count + 0 > 0) {
        printf "session_end_%s=%s ", reason, count
      }
    }
  ' | sed -E 's/ +$//'
}

# Cursor link verdict from one metrics scrape.
# Args: connected last_activity now seen_connected startup_deadline reachable
# Prints: starting | connected | disconnected
#
# reachable=0 means /metrics did not answer.
# seen_connected=1 means this process has already observed connected=1.
# startup_deadline is a unix timestamp; before it, a silent scrape is "starting".
# NORDIC_WORKER_STALE_SEC (default 90) is how long last_activity may lag.
# Activity 0 means "no heartbeat yet" (Cursor's documented zero), not stale.
nordic_worker_liveness() {
  local connected=${1:-0}
  local activity=${2:-0}
  local now=${3:-0}
  local seen=${4:-0}
  local deadline=${5:-0}
  local reachable=${6:-0}
  local stale=${NORDIC_WORKER_STALE_SEC:-90}

  case "$connected" in
    '' | *[!0-9-]*) connected=0 ;;
  esac
  case "$activity" in
    '' | *[!0-9-]*) activity=0 ;;
  esac
  case "$now" in
    '' | *[!0-9-]*) now=0 ;;
  esac
  case "$deadline" in
    '' | *[!0-9-]*) deadline=0 ;;
  esac

  if [ "$reachable" != 1 ]; then
    if [ "$seen" = 1 ] || [ "$now" -ge "$deadline" ]; then
      printf 'disconnected'
    else
      printf 'starting'
    fi
    return 0
  fi

  if [ "$connected" = 1 ]; then
    if [ "$activity" -gt 0 ] && [ $((now - activity)) -gt "$stale" ]; then
      printf 'disconnected'
      return 0
    fi
    printf 'connected'
    return 0
  fi

  if [ "$seen" = 0 ] && [ "$now" -lt "$deadline" ]; then
    printf 'starting'
    return 0
  fi
  printf 'disconnected'
}

# Fold one verdict into a confirm streak.
# Args: verdict streak [need]
# Prints: "<streak> <ok|wait|exit>"
# `exit` means the link has stayed down for `need` observations (default 2).
nordic_worker_observe() {
  local verdict=$1
  local streak=$2
  local need=${3:-2}
  case "$streak" in
    '' | *[!0-9]*) streak=0 ;;
  esac
  case "$need" in
    '' | *[!0-9]*) need=2 ;;
  esac
  case "$verdict" in
    connected)
      printf '0 ok'
      ;;
    disconnected)
      streak=$((streak + 1))
      if [ "$streak" -ge "$need" ]; then
        printf '%s exit' "$streak"
      else
        printf '%s wait' "$streak"
      fi
      ;;
    *)
      printf '%s wait' "$streak"
      ;;
  esac
}
