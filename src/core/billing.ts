/**
 * Shunkan pricing decisions. Stripe is the ledger: the Vercel AI Gateway
 * writes meter `token-billing-tokens` for the profile's customer, and
 * Billing Credit Grants pay the metered price. Nothing here stores a
 * balance or a debt.
 *
 * The Basic plan charges 150 MXN a month. Half of that charge is granted
 * back as metered credit (the monthly allotment). The other half is the
 * licensed price with no credit against it, which is the revenue. Recharge
 * grants the full amount paid, with no expiry, and is applied only after
 * the monthly grant. Pay as you go is the third step, and only when the
 * feature flag says so.
 */

export const BILLING_CURRENCY = "mxn" as const;

/** Licensed recurring price. The Stripe Price is created in the dashboard. */
export const BASIC_PLAN_CENTAVOS = 15_000;

/** Half of the Basic payment. The other half is never granted. */
export const MONTHLY_ALLOTMENT_CENTAVOS = BASIC_PLAN_CENTAVOS / 2;

/**
 * Stripe applies the lowest priority number first. Monthly credit is 0 so
 * it is spent before recharge at 100.
 */
export const MONTHLY_GRANT_PRIORITY = 0;
export const RECHARGE_GRANT_PRIORITY = 100;

/**
 * The usage invoice is finalized at period end. One hour lets that invoice
 * still see the grant. The next period's usage is invoiced a month later,
 * so the grace does not roll the allotment forward. The licensed fee is
 * not a metered price, so the grace cannot pay the revenue half.
 */
export const MONTHLY_GRANT_GRACE_SECONDS = 60 * 60;

export const GRANT_KIND_METADATA = "shunkan_kind";
export const MONTHLY_GRANT_KIND = "monthly";
export const RECHARGE_GRANT_KIND = "recharge";

const MIN_RECHARGE_MXN = 1;
const MAX_RECHARGE_MXN = 100_000;

export interface CreditPools {
	/** Centavos of the current period's allotment still available. */
	monthlyCentavos: number;
	/** Centavos of non-expiring recharge still available. */
	rechargeCentavos: number;
}

export type SpendSource = "monthly" | "recharge" | "payg";

export type SpendDecision =
	| { allow: true; source: SpendSource }
	| { allow: false; source: "blocked" };

export class SpendBlockedError extends Error {
	readonly source = "blocked" as const;
	constructor() {
		super("Monthly tokens and recharge credits are used up. Recharge to continue.");
		this.name = "SpendBlockedError";
	}
}

function wholeCentavos(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.floor(value);
}

/**
 * Monthly allotment, then non-expiring recharge, then pay as you go only
 * when the flag is on. An empty pair with the flag off is a block, not a
 * charge: this app does not extend credit.
 */
export function decideSpend(pools: CreditPools, payAsYouGo: boolean): SpendDecision {
	if (wholeCentavos(pools.monthlyCentavos) > 0) return { allow: true, source: "monthly" };
	if (wholeCentavos(pools.rechargeCentavos) > 0) return { allow: true, source: "recharge" };
	if (payAsYouGo) return { allow: true, source: "payg" };
	return { allow: false, source: "blocked" };
}

/** Unbilled metered usage draws the monthly allotment first, then recharge. */
export function remainingAfterUsage(pools: CreditPools, unbilledCentavos: number): CreditPools {
	let usage = wholeCentavos(unbilledCentavos);
	const monthly = wholeCentavos(pools.monthlyCentavos);
	const recharge = wholeCentavos(pools.rechargeCentavos);
	const fromMonthly = Math.min(monthly, usage);
	usage -= fromMonthly;
	const fromRecharge = Math.min(recharge, usage);
	return {
		monthlyCentavos: monthly - fromMonthly,
		rechargeCentavos: recharge - fromRecharge,
	};
}

export interface GrantSnapshot {
	kind: typeof MONTHLY_GRANT_KIND | typeof RECHARGE_GRANT_KIND;
	availableCentavos: number;
	/** Unix seconds. Null means the grant does not expire. */
	expiresAt: number | null;
	voided: boolean;
}

/** The app stops spending a monthly grant at period end, before the Stripe grace. */
export function monthlyGrantSpendable(expiresAt: number | null, nowSeconds: number): boolean {
	if (expiresAt === null) return true;
	return expiresAt - MONTHLY_GRANT_GRACE_SECONDS > nowSeconds;
}

export function poolsFromGrants(
	grants: readonly GrantSnapshot[],
	unbilledCentavos: number,
	nowSeconds: number,
): CreditPools {
	let monthly = 0;
	let recharge = 0;
	for (const grant of grants) {
		if (grant.voided) continue;
		const available = wholeCentavos(grant.availableCentavos);
		if (available === 0) continue;
		if (grant.kind === MONTHLY_GRANT_KIND) {
			if (!monthlyGrantSpendable(grant.expiresAt, nowSeconds)) continue;
			monthly += available;
			continue;
		}
		if (grant.expiresAt !== null && grant.expiresAt <= nowSeconds) continue;
		recharge += available;
	}
	return remainingAfterUsage({ monthlyCentavos: monthly, rechargeCentavos: recharge }, unbilledCentavos);
}

/** Missing, null, and false are off. Only an explicit true enables pay as you go. */
export function payAsYouGoFromFlags(flags: { payAsYouGo?: boolean | null } | null | undefined): boolean {
	return flags?.payAsYouGo === true;
}

export function invoiceLinePriceId(line: {
	pricing?: { price_details?: { price?: string | { id?: string } | null } | null } | null;
}): string | null {
	const price = line.pricing?.price_details?.price;
	if (typeof price === "string" && price) return price;
	if (price && typeof price === "object" && typeof price.id === "string" && price.id) return price.id;
	return null;
}

export function meteredUsageCentavos(
	lines: readonly { priceId: string | null; subtotalCentavos: number }[],
	tokenPriceId: string,
): number {
	let total = 0;
	for (const line of lines) {
		if (line.priceId !== tokenPriceId) continue;
		total += wholeCentavos(line.subtotalCentavos);
	}
	return total;
}

export interface MonthlyGrantSpec {
	amountCentavos: number;
	currency: typeof BILLING_CURRENCY;
	priority: number;
	expiresAt: number;
	effectiveAt: number | null;
	idempotencyKey: string;
	metadata: {
		shunkan_kind: typeof MONTHLY_GRANT_KIND;
		invoice: string;
		basic_centavos: string;
		allotment_centavos: string;
	};
	name: string;
	category: "paid";
}

/**
 * Half of a paid Basic invoice, scoped later to the token price only.
 * Usage invoices that do not contain the Basic price grant nothing, so a
 * recharge subscription cannot mint a monthly allotment.
 */
export function monthlyGrantForInvoice(invoice: {
	id: string;
	currency: string | null;
	billingReason: string | null;
	amountPaidCentavos: number;
	hasBasicPrice: boolean;
	periodStart: number | null;
	periodEnd: number | null;
}): MonthlyGrantSpec | null {
	if (!invoice.hasBasicPrice) return null;
	if (invoice.currency !== BILLING_CURRENCY) return null;
	if (invoice.billingReason !== "subscription_create" && invoice.billingReason !== "subscription_cycle") return null;
	if (!invoice.id || invoice.periodEnd === null) return null;
	if (invoice.amountPaidCentavos < BASIC_PLAN_CENTAVOS) return null;
	return {
		amountCentavos: MONTHLY_ALLOTMENT_CENTAVOS,
		currency: BILLING_CURRENCY,
		priority: MONTHLY_GRANT_PRIORITY,
		expiresAt: invoice.periodEnd + MONTHLY_GRANT_GRACE_SECONDS,
		effectiveAt: invoice.periodStart,
		idempotencyKey: `shunkan_monthly_${invoice.id}`,
		metadata: {
			shunkan_kind: MONTHLY_GRANT_KIND,
			invoice: invoice.id,
			basic_centavos: String(BASIC_PLAN_CENTAVOS),
			allotment_centavos: String(MONTHLY_ALLOTMENT_CENTAVOS),
		},
		name: "Monthly token allotment",
		category: "paid",
	};
}

export interface RechargeGrantSpec {
	amountCentavos: number;
	currency: typeof BILLING_CURRENCY;
	priority: number;
	idempotencyKey: string;
	metadata: {
		shunkan_kind: typeof RECHARGE_GRANT_KIND;
		session: string;
	};
	name: string;
	category: "paid";
}

/** The whole recharge payment becomes credit. It does not expire. */
export function rechargeGrantForPayment(session: {
	id: string;
	kind: string | null;
	paymentStatus: string | null;
	currency: string | null;
	amountCentavos: number | null;
}): RechargeGrantSpec | null {
	if (session.kind !== RECHARGE_GRANT_KIND) return null;
	if (session.paymentStatus !== "paid") return null;
	if (session.currency !== BILLING_CURRENCY) return null;
	if (!session.id || session.amountCentavos === null) return null;
	const amount = wholeCentavos(session.amountCentavos);
	if (amount < MIN_RECHARGE_MXN * 100 || amount > MAX_RECHARGE_MXN * 100) return null;
	return {
		amountCentavos: amount,
		currency: BILLING_CURRENCY,
		priority: RECHARGE_GRANT_PRIORITY,
		idempotencyKey: `shunkan_recharge_${session.id}`,
		metadata: { shunkan_kind: RECHARGE_GRANT_KIND, session: session.id },
		name: "Recharge",
		category: "paid",
	};
}

/** Integer MXN from the recharge form. Fractional pesos are refused. */
export function rechargeCentavosFromMxn(value: unknown): number | null {
	const mxn = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
	if (!Number.isInteger(mxn) || mxn < MIN_RECHARGE_MXN || mxn > MAX_RECHARGE_MXN) return null;
	return mxn * 100;
}
