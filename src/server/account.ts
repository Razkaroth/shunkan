/**
 * The Payload user behind a product request. Profile routes redirect to
 * the login page when this is missing; they do not answer with an empty
 * profile list.
 */
export const LOGIN_PATH = "/login";

export function loginRedirect(req: Request): Response {
	return Response.redirect(new URL(LOGIN_PATH, req.url), 303);
}

export async function requestAccountId(req: Request | undefined): Promise<string | null> {
	if (!req) return null;
	try {
		const { getPayloadAuth } = await import("payload-auth/better-auth/plugin");
		const { default: config } = await import("../../payload.config.ts");
		const payload = await getPayloadAuth(config);
		const session = await payload.betterAuth.api.getSession({ headers: req.headers });
		const id = session && typeof session === "object" && "user" in session
			? (session as { user?: { id?: unknown } }).user?.id
			: null;
		return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
	} catch (err) {
		console.warn("account session could not be read", err instanceof Error ? err.message : err);
		return null;
	}
}
