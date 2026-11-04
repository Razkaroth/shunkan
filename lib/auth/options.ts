import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import type { BetterAuthOptions, PayloadAuthOptions } from "payload-auth/better-auth";
import { readEnv } from "../env.ts";
import { resolveDiscord } from "./discord.ts";

const env = readEnv();
const publicUrl = new URL(env.NEXT_PUBLIC_URL);
const localPort = publicUrl.port || (publicUrl.protocol === "https:" ? "443" : "80");
const discord = resolveDiscord({
	dev: {
		enabled: Boolean(env.DISCORD_CLIENT_ID_DEV && env.DISCORD_CLIENT_SECRET_DEV),
		clientId: env.DISCORD_CLIENT_ID_DEV ?? "",
		clientSecret: env.DISCORD_CLIENT_SECRET_DEV ?? "",
	},
	prod: {
		enabled: Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET),
		clientId: env.DISCORD_CLIENT_ID ?? "",
		clientSecret: env.DISCORD_CLIENT_SECRET ?? "",
	},
});

const betterAuthOptions = {
	appName: "Shunkan",
	baseURL: env.NEXT_PUBLIC_URL,
	trustedOrigins: [
		env.NEXT_PUBLIC_URL,
		`http://127.0.0.1:${localPort}`,
		`http://localhost:${localPort}`,
	],
	secret: env.PAYLOAD_SECRET,
	emailAndPassword: {
		enabled: true,
		disableSignUp: true,
	},
	...(discord
		? {
				socialProviders: {
					discord: {
						clientId: discord.clientId,
						clientSecret: discord.clientSecret,
						disableImplicitSignUp: true,
						disableSignUp: true,
					},
				},
				...(discord.accountLinking
					? {
							account: {
								accountLinking: { enabled: true, trustedProviders: ["discord"] },
							},
						}
					: {}),
			}
		: {}),
	plugins: [
		admin({
			defaultRole: "user",
			adminRoles: ["admin", "super-admin"],
			roles: {
				user: userAc,
				admin: adminAc,
				"super-admin": adminAc,
			},
		}),
		nextCookies(),
	],
} satisfies BetterAuthOptions;

/**
 * Payload Better Auth options. Roles match Foundry: user, admin, super-admin.
 * Email signup stays disabled on the public auth API, and Discord cannot
 * create accounts. The university trial creates one account from
 * src/server/trial.ts after its GPT-Sol session ends. That path does not
 * enable public signup and does not bill anyone. The invite middleware is
 * left off: with Better Auth 1.7 it short-circuits every API call.
 */
export const payloadAuthOptions = {
	users: {
		slug: "users",
		roles: ["user", "admin", "super-admin"],
		adminRoles: ["admin", "super-admin"],
		defaultRole: "user",
		defaultAdminRole: "super-admin",
		allowedFields: ["name"],
	},
	betterAuthOptions,
} satisfies PayloadAuthOptions;
