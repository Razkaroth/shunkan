#!/usr/bin/env bash
# Local stack for this worktree. Run inside direnv so ports and secrets are set.
set -euo pipefail

root=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$root" ]; then
	printf 'dev: not inside a git worktree\n' >&2
	exit 1
fi
cd "$root"

export PM2_HOME="${PM2_HOME:-$root/.pm2}"

usage() {
	cat <<'EOF'
Usage: dev <command>

  start          PM2: Mongo, Silo, bucket init, Next dev
  stop           Stop this worktree's PM2 processes and Compose project
  logs [name]    pm2 logs
  agent <cmd>    Cursor worker: start|stop|restart|status|logs|print|run
EOF
}

cmd=${1:-}
shift || true

case "$cmd" in
	start)
		command -v pm2 >/dev/null 2>&1 || { printf 'dev: pm2 not on PATH\n' >&2; exit 1; }
		command -v docker >/dev/null 2>&1 || { printf 'dev: docker not on PATH\n' >&2; exit 1; }
		pm2 start devenv/pm2/deps.config.cjs
		pm2 start devenv/pm2/app.config.cjs
		pm2 status
		;;
	stop)
		command -v pm2 >/dev/null 2>&1 || { printf 'dev: pm2 not on PATH\n' >&2; exit 1; }
		pm2 delete mongo silo mongo-init createbuckets shunkan >/dev/null 2>&1 || true
		docker compose --project-directory . -f devenv/compose.yml down
		;;
	logs)
		exec pm2 logs "$@"
		;;
	agent)
		exec bash "$root/devenv/agent-worker.sh" "$@"
		;;
	-h|--help|help|"")
		usage
		;;
	*)
		printf 'dev: unknown command %s\n' "$cmd" >&2
		usage >&2
		exit 1
		;;
esac
