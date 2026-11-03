export type DiscordCredentials = {
	enabled: boolean;
	clientId: string;
	clientSecret: string;
};

export type DiscordConfig = {
	isProduction?: boolean;
	accountLinking?: boolean;
	dev?: DiscordCredentials;
	prod?: DiscordCredentials;
};

export type ResolvedDiscord = {
	clientId: string;
	clientSecret: string;
	accountLinking: boolean;
};

function filled(value: string | undefined): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function production(input?: { isProduction?: boolean; nodeEnv?: string; vercelEnv?: string }): boolean {
	if (typeof input?.isProduction === "boolean") return input.isProduction;
	const vercelEnv = input?.vercelEnv ?? process.env.VERCEL_ENV;
	if (vercelEnv) return vercelEnv === "production";
	return (input?.nodeEnv ?? process.env.NODE_ENV) === "production";
}

function slot(value: DiscordCredentials | undefined) {
	if (!value || value.enabled !== true) return undefined;
	if (!filled(value.clientId) || !filled(value.clientSecret)) return undefined;
	return { clientId: value.clientId, clientSecret: value.clientSecret };
}

/** Dev Discord app locally, prod Discord app when VERCEL_ENV or NODE_ENV says production. */
export function resolveDiscord(
	config: DiscordConfig | undefined,
	env?: { nodeEnv?: string; vercelEnv?: string },
): ResolvedDiscord | undefined {
	if (!config) return undefined;
	const social = slot(production({ isProduction: config.isProduction, ...env }) ? config.prod : config.dev);
	if (!social) return undefined;
	return { ...social, accountLinking: config.accountLinking !== false };
}
