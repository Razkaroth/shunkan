/**
 * The pay-as-you-go flag is the Payload global `feature-flags`, field
 * `payAsYouGo`. The spend gate is the reader. A missing global, a failed
 * read, or any value other than true stays off.
 */
import { payAsYouGoFromFlags } from "../core/billing.ts";

const FLAG_TTL_MS = 5_000;
let cached: { at: number; value: boolean } | null = null;

export function clearPayAsYouGoCache(): void {
	cached = null;
}

export async function payAsYouGoEnabled(now = Date.now()): Promise<boolean> {
	if (cached && now - cached.at < FLAG_TTL_MS) return cached.value;
	const value = await readFlag();
	cached = { at: now, value };
	return value;
}

async function readFlag(): Promise<boolean> {
	try {
		const { getPayload } = await import("payload");
		const { default: config } = await import("../../payload.config.ts");
		const payload = await getPayload({ config });
		const flags = await payload.findGlobal({ slug: "feature-flags", overrideAccess: true });
		return payAsYouGoFromFlags(flags);
	} catch (err) {
		console.warn("feature-flags global could not be read; pay as you go stays off", err instanceof Error ? err.message : err);
		return false;
	}
}
