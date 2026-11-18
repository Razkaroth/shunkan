/**
 * Create one Payload user and sign that browser in.
 * Public Better Auth signup stays disabled. This route uses the admin
 * create, the same one the trial uses, then signs the new user in.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown; name?: unknown };
	const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
	const password = typeof body.password === "string" ? body.password : "";
	const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : (email.split("@")[0] || "Learner");
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
		return Response.json({ error: "Use an email and a password of at least 8 characters." }, { status: 400 });
	}
	try {
		const { getPayloadAuth } = await import("payload-auth/better-auth/plugin");
		const { default: config } = await import("../../../../payload.config.ts");
		const payload = await getPayloadAuth(config);
		const betterAuth = payload.betterAuth as unknown as {
			api: {
				createUser: (args: { body: Record<string, unknown> }) => Promise<{ user?: { id?: string | null } }>;
				signInEmail: (args: { body: { email: string; password: string }; asResponse: true }) => Promise<Response>;
			};
		};
		const created = await betterAuth.api.createUser({
			body: {
				data: { emailVerified: true },
				email,
				name,
				password,
				role: ["user"],
			},
		});
		if (!created.user?.id) return Response.json({ error: "The account could not be created." }, { status: 503 });
		return await betterAuth.api.signInEmail({
			body: { email, password },
			asResponse: true,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "";
		if (/already|exists|duplicate/i.test(message)) {
			return Response.json({ error: "That email is already an account." }, { status: 409 });
		}
		console.error("account signup failed", message);
		return Response.json({ error: "The account could not be created." }, { status: 503 });
	}
}
