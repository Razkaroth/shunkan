/** Tailscale preview commands for this app's local ports.
 *
 * On a tailnet host the app and Silo ports are exposed over HTTPS at the
 * tailnet DNS name. `dev serve` is tailnet-only (`tailscale serve`).
 * `dev serve --public` uses `tailscale funnel` instead.
 */

const TAILNET_SUFFIX = ".ts.net";

/** @param {{ tailscaleOnPath: boolean, host: string, scheme: string }} input */
export function shouldServeTailscale(input) {
	return (
		input.tailscaleOnPath &&
		input.scheme === "https" &&
		input.host.toLowerCase().endsWith(TAILNET_SUFFIX)
	);
}

/** @param {{ public?: boolean } | undefined} options */
function previewVerb(options) {
	return options?.public ? "funnel" : "serve";
}

/** @param {number} port @param {{ public?: boolean } | undefined} options */
export function serveCommand(port, options) {
	return [previewVerb(options), "--bg", `--https=${port}`, String(port)];
}

/** @param {number} port @param {{ public?: boolean } | undefined} options */
export function offCommand(port, options) {
	return [previewVerb(options), `--https=${port}`, String(port), "off"];
}

/** @param {number[]} ports @param {{ public?: boolean } | undefined} options */
export function serveSlots(ports, options) {
	return ports.map((port) => serveCommand(port, options));
}

/** @param {number[]} ports @param {{ public?: boolean } | undefined} options */
export function offSlots(ports, options) {
	return ports.map((port) => offCommand(port, options));
}
