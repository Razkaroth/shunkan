import { z } from "zod";

const schema = z.object({
	PAYLOAD_SECRET: z.string().min(1),
	MONGODB_URI: z.string().min(1),
	NEXT_PUBLIC_URL: z.string().url(),
	DISCORD_CLIENT_ID_DEV: z.string().min(1).optional(),
	DISCORD_CLIENT_SECRET_DEV: z.string().min(1).optional(),
	DISCORD_CLIENT_ID: z.string().min(1).optional(),
	DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
	SEED_SUPERADMIN_EMAIL: z.string().email().optional(),
	SEED_SUPERADMIN_PASSWORD: z.string().min(1).optional(),
	SEED_SUPERADMIN_NAME: z.string().min(1).optional(),
	S3_BUCKET: z.string().min(1).default("shunkan"),
	S3_ENDPOINT: z.string().min(1).default("http://127.0.0.1:9000"),
	S3_REGION: z.string().min(1).default("us-east-1"),
	S3_ACCESS_KEY_ID: z.string().min(1).default("siloadmin"),
	S3_SECRET_ACCESS_KEY: z.string().min(1).default("silo-local-dev"),
	NODE_ENV: z.string().optional(),
	VERCEL_ENV: z.string().optional(),
	/** AI Gateway credential for local, CI, and non-Vercel hosts. Vercel deployments can use OIDC instead. */
	AI_GATEWAY_API_KEY: z.string().min(1).optional(),
	/** Owner DeepSeek key. Trial DeepSeek calls send it as gateway BYOK so those calls spend DeepSeek credits. */
	DEEPSEEK_API_KEY: z.string().min(1).optional(),
	/** One invite code a friend can redeem. Absent means the trial is closed. */
	TRIAL_INVITE_CODE: z.string().min(1).optional(),
	/** Restricted Stripe key (rk_…) with Billing meter events write. The gateway sends meter events; this app does not. */
	STRIPE_RESTRICTED_ACCESS_KEY: z.string().min(1).optional(),
});

export type AppEnv = z.infer<typeof schema>;

export function readEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
	return schema.parse({
		PAYLOAD_SECRET: source.PAYLOAD_SECRET,
		MONGODB_URI: source.MONGODB_URI,
		NEXT_PUBLIC_URL: source.NEXT_PUBLIC_URL,
		DISCORD_CLIENT_ID_DEV: source.DISCORD_CLIENT_ID_DEV,
		DISCORD_CLIENT_SECRET_DEV: source.DISCORD_CLIENT_SECRET_DEV,
		DISCORD_CLIENT_ID: source.DISCORD_CLIENT_ID,
		DISCORD_CLIENT_SECRET: source.DISCORD_CLIENT_SECRET,
		SEED_SUPERADMIN_EMAIL: source.SEED_SUPERADMIN_EMAIL,
		SEED_SUPERADMIN_PASSWORD: source.SEED_SUPERADMIN_PASSWORD,
		SEED_SUPERADMIN_NAME: source.SEED_SUPERADMIN_NAME,
		S3_BUCKET: source.S3_BUCKET,
		S3_ENDPOINT: source.S3_ENDPOINT,
		S3_REGION: source.S3_REGION,
		S3_ACCESS_KEY_ID: source.S3_ACCESS_KEY_ID,
		S3_SECRET_ACCESS_KEY: source.S3_SECRET_ACCESS_KEY,
		NODE_ENV: source.NODE_ENV,
		VERCEL_ENV: source.VERCEL_ENV,
		AI_GATEWAY_API_KEY: source.AI_GATEWAY_API_KEY,
		DEEPSEEK_API_KEY: source.DEEPSEEK_API_KEY,
		TRIAL_INVITE_CODE: source.TRIAL_INVITE_CODE,
		STRIPE_RESTRICTED_ACCESS_KEY: source.STRIPE_RESTRICTED_ACCESS_KEY,
	});
}
