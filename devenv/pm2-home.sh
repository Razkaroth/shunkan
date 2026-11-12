# PM2 daemon directories. Sourced by .envrc and devenv scripts.
# No `set -e` — callers own errexit.
#
# PM2 puts rpc.sock and pub.sock inside PM2_HOME. The socket path must fit
# in sun_path (108 bytes). A worktree path overflows that limit, so the
# directory is never under the repo.
#
# Foundry's home is /tmp/<app.branch> because those branches are app.feature
# (`app.one` → /tmp/app.one). This repo has one app, so the key is
# shunkan.<branch> (`master` → /tmp/shunkan.master). Slashes in the branch
# become dashes. Different branches do not share a home.
# The dev-agent daemon uses /tmp/shunkan.<branch>-agent so `dev stop`
# cannot kill it.

# Print the branch with every / replaced by -. Empty, ".", and ".." fail.
nordic_pm2_branch_key() {
  local branch=${1-}
  local key
  key=$(printf '%s' "$branch" | tr '/' '-')
  if [ -z "$key" ] || [ "$key" = "." ] || [ "$key" = ".." ]; then
    return 1
  fi
  printf '%s' "$key"
}

# Stack PM2_HOME for a branch. Prints nothing and returns 1 when the key is unusable.
nordic_pm2_home() {
  local key
  key=$(nordic_pm2_branch_key "$1") || return 1
  printf '/tmp/shunkan.%s' "$key"
}

# Dev-agent PM2_HOME. Sibling of the stack home, not a directory inside it.
nordic_pm2_agent_home() {
  local key
  key=$(nordic_pm2_branch_key "$1") || return 1
  printf '/tmp/shunkan.%s-agent' "$key"
}

# Current branch, or detached-<shortsha> when HEAD is detached.
# The fallback is not the worktree path.
nordic_pm2_current_branch() {
  local branch
  branch=$(git branch --show-current 2>/dev/null || true)
  if [ -n "$branch" ]; then
    printf '%s' "$branch"
    return 0
  fi
  printf 'detached-%s' "$(git rev-parse --short=12 HEAD 2>/dev/null || printf 'unknown')"
}

# Export the stack PM2_HOME. An already-set PM2_HOME wins (direnv).
nordic_pm2_export_stack_home() {
  if [ -n "${PM2_HOME:-}" ]; then
    export PM2_HOME
    return 0
  fi
  local branch
  branch=$(nordic_pm2_current_branch)
  PM2_HOME=$(nordic_pm2_home "$branch") || return 1
  export PM2_HOME
}

# Export the dev-agent PM2_HOME, replacing any stack PM2_HOME inherited from direnv.
# NORDIC_PM2_AGENT_HOME still overrides.
nordic_pm2_export_agent_home() {
  if [ -n "${NORDIC_PM2_AGENT_HOME:-}" ]; then
    export PM2_HOME="$NORDIC_PM2_AGENT_HOME"
    return 0
  fi
  local branch
  branch=$(nordic_pm2_current_branch)
  PM2_HOME=$(nordic_pm2_agent_home "$branch") || return 1
  export PM2_HOME
}
