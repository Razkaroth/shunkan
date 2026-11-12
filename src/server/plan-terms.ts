/**
 * Monthly price and commission are the Payload global `pricing`, fields
 * `monthlyPriceMxn` and `commissionPercent`. A missing global, a failed
 * read, or an empty field stays unset. Callers wait. This does not fill
 * in a price or a grant.
 */
import { planTermsFromPricing, type PlanTerms } from "../core/billing.ts";

const TERMS_TTL_MS = 5_000;
let cached: { at: number; value: PlanTerms | null } | null = null;

export function clearPlanTermsCache(): void {
	cached = null;
}

export async function readPlanTerms(now = Date.now()): Promise<PlanTerms | null> {
	if (cached && now - cached.at < TERMS_TTL_MS) return cached.value;
	const value = await loadPlanTerms();
	cached = { at: now, value };
	return value;
}

async function loadPlanTerms(): Promise<PlanTerms | null> {
	try {
		const { getPayload } = await import("payload");
		const { default: config } = await import("../../payload.config.ts");
		const payload = await getPayload({ config });
		const doc = await payload.findGlobal({ slug: "pricing", overrideAccess: true });
		return planTermsFromPricing(doc);
	} catch (err) {
		console.warn("pricing global could not be read; monthly price stays unset", err instanceof Error ? err.message : err);
		return null;
	}
}
