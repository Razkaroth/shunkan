#!/usr/bin/env bash
# Open a URL with the desktop default browser (system xdg-open).
# Take the last argument so callers can forward extra argv before the URL.
set -euo pipefail

url="${!#}"
if [[ "$url" != *://* ]]; then
	url="${1:-}"
fi
if [[ -z "$url" || "$url" != *://* ]]; then
	printf 'open-browser: missing URL\n' >&2
	exit 1
fi

# Avoid recursion: system xdg-open falls back to $BROWSER.
unset BROWSER BROWSER_ARGS
exec xdg-open "$url"
