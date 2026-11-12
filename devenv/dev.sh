#!/usr/bin/env bash
# Local runtime CLI for this app. Run inside direnv so ports and secrets are set.
set -euo pipefail

usage() {
	cat <<'EOF'
Usage: dev <command> [flags]

Local runtime for this Shunkan checkout.

  dev start [--quiet]     Start Mongo, Silo, bucket init, and Next via PM2.
                          Opens the app URL after 3s unless --quiet.
                          On a tailnet host, also publishes the app and Silo
                          ports with `tailscale serve`.
  dev stop                Stop this worktree's PM2 processes and Compose project.
                          Volumes are kept. Tailscale serve and funnel for these
                          ports are removed.
  dev serve [--public]    Preview the app and Silo ports on the tailnet
                          (`tailscale serve`). --public uses `tailscale funnel`.
                          Does not start the stack.
  dev logs [args...]      Tail PM2 logs for the Next app
  dev agent <cmd>         Cursor worker: start|stop|restart|status|logs|print|run
  dev lint | typecheck | test | build
                          pnpm run <task>
  dev seed [args...]      pnpm run seed -- [args...]
EOF
}

usage_start() {
	cat <<'EOF'
Usage: dev start [--quiet]

Start Mongo, Silo, bucket init, and the Next app via PM2.
Opens the app URL after 3 seconds unless --quiet.
EOF
}

usage_stop() {
	cat <<'EOF'
Usage: dev stop

Stop this worktree's PM2 processes, then tear down the Compose project.
Docker volumes are kept. Tailscale previews for this checkout's ports are removed.
EOF
}

usage_logs() {
	cat <<'EOF'
Usage: dev logs [pm2-logs-args...]

Tail PM2 logs for the Next app (e.g. `dev logs --lines 200`).
EOF
}

usage_serve() {
	cat <<'EOF'
Usage: dev serve [--public]

Expose this checkout's app and Silo ports as an HTTPS preview on the tailnet
DNS name. Does not start the stack.

Default is tailnet-only: `tailscale serve`.
`--public` uses `tailscale funnel` instead, so the preview is reachable on
the public internet.
EOF
}

root=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$root" ]; then
	printf 'dev: not inside a git worktree\n' >&2
	exit 1
fi
cd "$root"

die() {
	printf 'dev: %s\n' "$*" >&2
	exit 1
}

# shellcheck source=./pm2-home.sh
. "$root/devenv/pm2-home.sh"
nordic_pm2_export_stack_home || die "could not derive PM2_HOME from the current branch"

# Print one `tailscale` argument line per port. Empty when this host is not
# a tailnet https preview, or when the ports are unset.
shunkan_tailscale_commands() {
	local mode=$1
	local exposure=${2:-serve}
	command -v node >/dev/null 2>&1 || return 1
	command -v tailscale >/dev/null 2>&1 || return 1
	TAILSCALE_MODE="$mode" TAILSCALE_EXPOSURE="$exposure" \
		DEV_PUBLIC_SCHEME="${DEV_PUBLIC_SCHEME:-}" \
		DEV_EXTERNAL_HOST="${DEV_EXTERNAL_HOST:-}" \
		APP_PORT="${APP_PORT:-}" \
		SILO_PORT="${SILO_PORT:-}" \
		node --input-type=module -e '
			import { offSlots, serveSlots, shouldServeTailscale } from "./devenv/dev-tailscale-serve.mjs";
			const host = process.env.DEV_EXTERNAL_HOST || "";
			const scheme = process.env.DEV_PUBLIC_SCHEME || "";
			if (!shouldServeTailscale({ tailscaleOnPath: true, host, scheme })) process.exit(0);
			const ports = [process.env.APP_PORT, process.env.SILO_PORT]
				.map((value) => Number(value))
				.filter((port) => Number.isInteger(port) && port > 0);
			if (ports.length === 0) process.exit(0);
			const options = { public: process.env.TAILSCALE_EXPOSURE === "funnel" };
			const slots = process.env.TAILSCALE_MODE === "off" ? offSlots(ports, options) : serveSlots(ports, options);
			for (const command of slots) console.log(command.join(" "));
		'
}

shunkan_tailscale_apply() {
	local mode=$1
	local exposure=${2:-serve}
	local cmd
	while IFS= read -r cmd; do
		[ -n "$cmd" ] || continue
		printf 'dev: tailscale %s\n' "$cmd" >&2
		# shellcheck disable=SC2086
		tailscale $cmd >/dev/null 2>&1 || true
	done < <(shunkan_tailscale_commands "$mode" "$exposure" || true)
}

open_app_later() {
	local url
	url="${NEXT_PUBLIC_URL:-${NEXT_PUBLIC_SERVER_URL:-http://127.0.0.1:${APP_PORT:-3300}}}"
	printf 'dev: opening %s in 3s\n' "$url" >&2
	nohup bash -c '
		sleep 3
		url=$1
		if [ -x "$2" ]; then
			"$2" "$url" >/dev/null 2>&1 || true
		elif command -v xdg-open >/dev/null 2>&1; then
			xdg-open "$url" >/dev/null 2>&1 || true
		fi
	' bash "$url" "$root/devenv/open-browser.sh" >/dev/null 2>&1 &
}

sub=${1:-}
if [ -z "$sub" ] || [ "$sub" = "-h" ] || [ "$sub" = "--help" ] || [ "$sub" = "help" ]; then
	usage
	exit 0
fi
shift

case "$sub" in
	start)
		quiet=false
		while [ "$#" -gt 0 ]; do
			case "$1" in
				--quiet) quiet=true ;;
				-h|--help)
					usage_start
					exit 0
					;;
				*) die "unknown flag: $1 (try: dev start --help)" ;;
			esac
			shift
		done
		command -v pm2 >/dev/null 2>&1 || die "pm2 not on PATH"
		command -v docker >/dev/null 2>&1 || die "docker not on PATH"
		printf 'dev start: pm2 home %s\n' "$PM2_HOME"
		shunkan_tailscale_apply start serve
		pm2 start devenv/pm2/deps.config.cjs
		pm2 start devenv/pm2/app.config.cjs
		pm2 status
		if [ "$quiet" = false ]; then
			open_app_later
		fi
		;;
	stop)
		for arg in "$@"; do
			case "$arg" in
				-h|--help)
					usage_stop
					exit 0
					;;
				*) die "unknown flag: $arg (try: dev stop --help)" ;;
			esac
		done
		command -v pm2 >/dev/null 2>&1 || die "pm2 not on PATH"
		printf 'dev stop: deleting pm2 processes\n'
		if [ -d "$PM2_HOME" ]; then
			pm2 delete all >/dev/null 2>&1 || true
		else
			printf 'dev stop: no PM2_HOME at %s (skipping pm2 delete)\n' "$PM2_HOME"
		fi
		if [ -n "${COMPOSE_PROJECT_NAME:-}" ] && command -v docker >/dev/null 2>&1; then
			printf 'dev stop: compose down for project %s\n' "$COMPOSE_PROJECT_NAME"
			docker compose -p "$COMPOSE_PROJECT_NAME" --project-directory "$root" -f "$root/devenv/compose.yml" down --remove-orphans >/dev/null 2>&1 ||
				printf 'dev stop: compose down skipped or failed (containers may still be up)\n' >&2
		else
			printf 'dev stop: COMPOSE_PROJECT_NAME unset or docker missing; skip compose down\n' >&2
		fi
		shunkan_tailscale_apply off serve
		shunkan_tailscale_apply off funnel
		printf 'dev stop: done\n'
		;;
	serve)
		exposure=serve
		for arg in "$@"; do
			case "$arg" in
				--public) exposure=funnel ;;
				-h|--help)
					usage_serve
					exit 0
					;;
				*) die "unknown flag: $arg (try: dev serve --help)" ;;
			esac
		done
		command -v tailscale >/dev/null 2>&1 || die "tailscale not on PATH"
		printf 'dev serve: tailscale %s\n' "$exposure"
		if [ "$exposure" = funnel ]; then
			shunkan_tailscale_apply off serve
		else
			shunkan_tailscale_apply off funnel
		fi
		shunkan_tailscale_apply start "$exposure"
		;;
	logs)
		for arg in "$@"; do
			case "$arg" in
				-h|--help)
					usage_logs
					exit 0
					;;
			esac
		done
		command -v pm2 >/dev/null 2>&1 || die "pm2 not on PATH"
		exec pm2 logs shunkan "$@"
		;;
	agent)
		exec bash "$root/devenv/agent-worker.sh" "$@"
		;;
	lint|typecheck|test|build)
		command -v pnpm >/dev/null 2>&1 || die "pnpm not on PATH"
		printf 'dev: %s\n' "$sub" >&2
		exec pnpm run "$sub" -- "$@"
		;;
	seed)
		command -v pnpm >/dev/null 2>&1 || die "pnpm not on PATH"
		printf 'dev: seed\n' >&2
		exec pnpm run seed -- "$@"
		;;
	*)
		die "unknown command: $sub (try: dev --help)"
		;;
esac
