import type { BasePayload, CollectionSlug } from "payload";
import { readEnv } from "../env.ts";

type BetterAuthCreateUserResult = {
	user?: { id?: string | null };
};

type PayloadWithBetterAuth = BasePayload & {
	betterAuth?: {
		api: {
			createUser: (args: {
				body: {
					data?: Record<string, unknown>;
					email: string;
					name: string;
					password: string;
					role?: string | string[];
				};
			}) => Promise<BetterAuthCreateUserResult>;
		};
	};
};

async function findUserIdByEmail(payload: BasePayload, email: string): Promise<string | null> {
	const { docs } = await payload.find({
		collection: "users" as CollectionSlug,
		depth: 0,
		limit: 1,
		overrideAccess: true,
		where: { email: { equals: email } },
	});
	const id = docs[0]?.id;
	return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

/**
 * Creates or updates the Discord super-admin by email.
 * Password login is the seed; Discord sign-in links to that same email.
 */
export async function seedDiscordSuperAdmin(payload: BasePayload): Promise<string | null> {
	const env = readEnv();
	const email = env.SEED_SUPERADMIN_EMAIL?.trim();
	const password = env.SEED_SUPERADMIN_PASSWORD;
	const name = env.SEED_SUPERADMIN_NAME?.trim() || "Discord Super Admin";

	if (!email && !password) {
		console.info("Skipping Discord super-admin seed (SEED_SUPERADMIN_EMAIL/PASSWORD unset)");
		return null;
	}
	if (!email || !password) {
		throw new Error("SEED_SUPERADMIN_EMAIL and SEED_SUPERADMIN_PASSWORD must both be set");
	}

	const existingId = await findUserIdByEmail(payload, email);
	if (existingId) {
		await payload.update({
			collection: "users",
			id: existingId,
			overrideAccess: true,
			data: { emailVerified: true, name, role: ["super-admin"] },
		});
		console.info(`Discord super-admin already present (${email})`);
		return existingId;
	}

	const betterAuth = (payload as PayloadWithBetterAuth).betterAuth;
	if (!betterAuth) throw new Error("Better Auth is not available on the Payload instance");

	const result = await betterAuth.api.createUser({
		body: {
			data: { emailVerified: true },
			email,
			name,
			password,
			role: ["super-admin"],
		},
	});
	if (!result.user?.id) throw new Error(`Better Auth did not return a user id for ${email}`);
	console.info(`Created Discord super-admin (${email})`);
	return String(result.user.id);
}
