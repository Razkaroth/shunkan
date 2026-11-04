/**
 * Stripe Checkout, credit grants, and the balance read for the spend gate.
 * The gateway meter `token-billing-tokens` stays the usage record. Grants
 * pay the metered price on the same customer the profile already sends as
 * `stripe-customer-id`. This module does not keep a second ledger.
 */
import Stripe from "stripe";
import { readEnv } from "../../lib/env.ts";
import {
	BASIC_PLAN_CENTAVOS,
	BILLING_CURRENCY,
	type CreditPools,
	type GrantSnapshot,
	invoiceLinePriceId,
	meteredUsageCentavos,
	MONTHLY_GRANT_KIND,
	monthlyGrantForInvoice,
	poolsFromGrants,
	RECHARGE_GRANT_KIND,
	rechargeCentavosFromMxn,
	rechargeGrantForPayment,
} from "../core/billing.ts";
import { isStripeCustomerId, type Profile } from "../core/users.ts";
import { readProfiles, writeProfiles } from "../store/users.ts";
import { requestProfile, UsersError } from "./users.ts";

const BASIC_INTEGRATION = "shunkan-basic-xkqmplrd";
const RECHARGE_INTEGRATION = "shunkan-recharge-vtbnwckj";
const POOL_TTL_MS = 5_000;

export class BillingError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "BillingError";
	}
}

export interface BillingPrices {
	basicPriceId: string;
	tokenPriceId: string;
}

interface BillingRuntime {
	stripe: Stripe;
	prices: BillingPrices;
}

let stripeClient: Stripe | undefined;
const poolCache = new Map<string, { at: number; pools: CreditPools }>();

export function clearCreditPoolCache(): void {
	poolCache.clear();
}

export function billingPrices(env: NodeJS.ProcessEnv = process.env): BillingPrices | null {
	const basicPriceId = env.STRIPE_BASIC_PRICE_ID?.trim();
	const tokenPriceId = env.STRIPE_TOKEN_PRICE_ID?.trim();
	if (!basicPriceId || !tokenPriceId) return null;
	return { basicPriceId, tokenPriceId };
}

function billingRuntime(): BillingRuntime {
	const key = process.env.STRIPE_BILLING_RESTRICTED_KEY?.trim();
	const prices = billingPrices();
	if (!key || !prices) throw new BillingError(503, "Billing is not configured.");
	if (!stripeClient) stripeClient = new Stripe(key);
	return { stripe: stripeClient, prices };
}

function requireProfile(req: Request): Profile {
	const profile = requestProfile(req);
	if (!profile) throw new UsersError(401, "Choose a profile first.");
	return profile;
}

/** Checkout created this customer for this profile. Do not replace one an admin already set. */
export function bindProfileStripeCustomer(profileId: string, customerId: string): void {
	if (!isStripeCustomerId(customerId)) return;
	const profiles = readProfiles();
	const target = profiles.find((profile) => profile.id === profileId);
	if (!target || target.stripeCustomerId) return;
	writeProfiles(profiles.map((profile) => (
		profile.id === profileId ? { ...profile, stripeCustomerId: customerId } : profile
	)));
}

async function customerForProfile(stripe: Stripe, profile: Profile): Promise<string> {
	if (profile.stripeCustomerId) return profile.stripeCustomerId;
	const customer = await stripe.customers.create({
		name: profile.name,
		metadata: { profileId: profile.id },
	}, { idempotencyKey: `shunkan_customer_${profile.id}` });
	return customer.id;
}

function appOrigin(): string {
	return readEnv().NEXT_PUBLIC_URL.replace(/\/$/, "");
}

export async function startBasicCheckout(req: Request): Promise<{ url: string }> {
	const profile = requireProfile(req);
	const { stripe, prices } = billingRuntime();
	const customer = await customerForProfile(stripe, profile);
	const origin = appOrigin();
	const session = await stripe.checkout.sessions.create({
		mode: "subscription",
		customer,
		client_reference_id: profile.id,
		integration_identifier: BASIC_INTEGRATION,
		metadata: { profileId: profile.id, shunkan_kind: "basic" },
		subscription_data: { metadata: { profileId: profile.id, shunkan_kind: "basic" } },
		line_items: [
			{ price: prices.basicPriceId, quantity: 1 },
			{ price: prices.tokenPriceId },
		],
		success_url: `${origin}/chat/new?billing=subscribed`,
		cancel_url: `${origin}/chat/new?billing=cancel`,
	});
	if (!session.url) throw new BillingError(502, "Stripe did not return a checkout URL.");
	return { url: session.url };
}

export async function startRechargeCheckout(req: Request, amountMxn: unknown): Promise<{ url: string }> {
	const centavos = rechargeCentavosFromMxn(amountMxn);
	if (centavos === null) throw new BillingError(400, "Enter a whole number of MXN between 1 and 100000.");
	const profile = requireProfile(req);
	const { stripe, prices } = billingRuntime();
	const customer = await customerForProfile(stripe, profile);
	const origin = appOrigin();
	const session = await stripe.checkout.sessions.create({
		mode: "payment",
		customer,
		client_reference_id: profile.id,
		integration_identifier: RECHARGE_INTEGRATION,
		metadata: { profileId: profile.id, shunkan_kind: RECHARGE_GRANT_KIND },
		line_items: [{
			quantity: 1,
			price_data: {
				currency: BILLING_CURRENCY,
				unit_amount: centavos,
				product_data: { name: "Shunkan recharge" },
			},
		}],
		success_url: `${origin}/chat/new?billing=recharged`,
		cancel_url: `${origin}/chat/new?billing=cancel`,
	});
	if (!session.url) throw new BillingError(502, "Stripe did not return a checkout URL.");
	return { url: session.url };
}

export interface BillingStatus {
	configured: boolean;
	currency: typeof BILLING_CURRENCY;
	basicPlanCentavos: number;
	monthlyAllotmentCentavos: number;
	payAsYouGo: boolean;
	hasCustomer: boolean;
	monthlyCentavos: number;
	rechargeCentavos: number;
}

export async function billingStatus(req: Request, payAsYouGo: boolean): Promise<BillingStatus> {
	const profile = requireProfile(req);
	const base: BillingStatus = {
		configured: billingPrices() !== null && Boolean(process.env.STRIPE_BILLING_RESTRICTED_KEY?.trim()),
		currency: BILLING_CURRENCY,
		basicPlanCentavos: BASIC_PLAN_CENTAVOS,
		monthlyAllotmentCentavos: BASIC_PLAN_CENTAVOS / 2,
		payAsYouGo,
		hasCustomer: Boolean(profile.stripeCustomerId),
		monthlyCentavos: 0,
		rechargeCentavos: 0,
	};
	if (!base.configured || !profile.stripeCustomerId) return base;
	try {
		const pools = await remainingCreditPools(profile.stripeCustomerId);
		return { ...base, ...pools };
	} catch (err) {
		console.warn("billing status could not read Stripe credit", err instanceof Error ? err.message : err);
		return base;
	}
}

export async function billingWebhookResponse(rawBody: string, signature: string | null): Promise<Response> {
	const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
	if (!secret) return Response.json({ error: "Billing webhook is not configured." }, { status: 503 });
	if (!signature) return Response.json({ error: "Missing Stripe signature." }, { status: 400 });
	let event: Stripe.Event;
	try {
		event = billingRuntime().stripe.webhooks.constructEvent(rawBody, signature, secret);
	} catch (err) {
		if (err instanceof BillingError) return Response.json({ error: err.message }, { status: err.status });
		return Response.json({ error: "Stripe signature was rejected." }, { status: 400 });
	}
	try {
		await fulfill(event);
	} catch (err) {
		console.error("billing webhook fulfillment failed", event.type, err instanceof Error ? err.message : err);
		const status = err instanceof BillingError ? err.status : 500;
		return Response.json({ error: "Billing fulfillment failed." }, { status });
	}
	return Response.json({ received: true });
}

async function fulfill(event: Stripe.Event): Promise<void> {
	if (event.type === "invoice.paid") {
		await grantMonthlyAllotment(event.data.object);
		return;
	}
	if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
		await fulfillCheckout(event.data.object);
	}
}

async function grantMonthlyAllotment(invoice: Stripe.Invoice): Promise<void> {
	const { stripe, prices } = billingRuntime();
	const lines = await allInvoiceLines(stripe, invoice);
	const basic = lines
		.map((line) => ({ priceId: invoiceLinePriceId(line), periodStart: line.period.start, periodEnd: line.period.end }))
		.find((line) => line.priceId === prices.basicPriceId);
	const spec = monthlyGrantForInvoice({
		id: invoice.id ?? "",
		currency: invoice.currency,
		billingReason: invoice.billing_reason,
		amountPaidCentavos: invoice.amount_paid,
		hasBasicPrice: basic !== undefined,
		periodStart: basic?.periodStart ?? null,
		periodEnd: basic?.periodEnd ?? null,
	});
	const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
	const profileId = invoice.parent?.subscription_details?.metadata?.profileId ?? invoice.metadata?.profileId ?? null;
	if (customerId && profileId) bindProfileStripeCustomer(profileId, customerId);
	if (!spec || !customerId) return;
	if (await grantAlreadyIssued(stripe, customerId, "invoice", spec.metadata.invoice)) return;
	await stripe.billing.creditGrants.create({
		customer: customerId,
		name: spec.name,
		category: spec.category,
		priority: spec.priority,
		amount: { type: "monetary", monetary: { currency: spec.currency, value: spec.amountCentavos } },
		applicability_config: { scope: { prices: [{ id: prices.tokenPriceId }] } },
		metadata: spec.metadata,
		...(spec.effectiveAt !== null ? { effective_at: spec.effectiveAt } : {}),
		expires_at: spec.expiresAt,
	}, { idempotencyKey: spec.idempotencyKey });
	clearCreditPoolCache();
	await ensureTokenPrice(stripe, customerId, prices.tokenPriceId, profileId);
}

async function fulfillCheckout(session: Stripe.Checkout.Session): Promise<void> {
	const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
	const profileId = session.metadata?.profileId ?? session.client_reference_id;
	if (customerId && profileId) bindProfileStripeCustomer(profileId, customerId);
	if (session.mode !== "payment") return;
	const { stripe, prices } = billingRuntime();
	const spec = rechargeGrantForPayment({
		id: session.id,
		kind: session.metadata?.shunkan_kind ?? null,
		paymentStatus: session.payment_status,
		currency: session.currency,
		amountCentavos: session.amount_total,
	});
	if (!spec || !customerId) return;
	if (await grantAlreadyIssued(stripe, customerId, "session", spec.metadata.session)) return;
	await stripe.billing.creditGrants.create({
		customer: customerId,
		name: spec.name,
		category: spec.category,
		priority: spec.priority,
		amount: { type: "monetary", monetary: { currency: spec.currency, value: spec.amountCentavos } },
		applicability_config: { scope: { prices: [{ id: prices.tokenPriceId }] } },
		metadata: spec.metadata,
	}, { idempotencyKey: spec.idempotencyKey });
	clearCreditPoolCache();
	await ensureTokenPrice(stripe, customerId, prices.tokenPriceId, profileId);
}

async function allInvoiceLines(stripe: Stripe, invoice: Stripe.Invoice): Promise<Stripe.InvoiceLineItem[]> {
	if (!invoice.id || !invoice.lines.has_more) return invoice.lines.data;
	return stripe.invoices.listLineItems(invoice.id, { limit: 100 }).autoPagingToArray({ limit: 100 });
}

async function grantAlreadyIssued(
	stripe: Stripe,
	customerId: string,
	key: "invoice" | "session",
	value: string,
): Promise<boolean> {
	let startingAfter: string | undefined;
	for (let page = 0; page < 5; page++) {
		const list = await stripe.billing.creditGrants.list({
			customer: customerId,
			limit: 100,
			...(startingAfter ? { starting_after: startingAfter } : {}),
		});
		if (list.data.some((grant) => grant.metadata?.[key] === value)) return true;
		if (!list.has_more) return false;
		startingAfter = list.data[list.data.length - 1]?.id;
		if (!startingAfter) return false;
	}
	return false;
}

async function ensureTokenPrice(
	stripe: Stripe,
	customerId: string,
	tokenPriceId: string,
	profileId: string | null,
): Promise<void> {
	const listed = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
	const open = listed.data.filter((sub) => sub.status === "active" || sub.status === "trialing" || sub.status === "past_due");
	const covered = open.some((sub) => sub.items.data.some((item) => priceId(item.price) === tokenPriceId));
	if (covered) return;
	const carrier = open[0];
	if (carrier) {
		await stripe.subscriptionItems.create({
			subscription: carrier.id,
			price: tokenPriceId,
			proration_behavior: "none",
		});
		return;
	}
	await stripe.subscriptions.create({
		customer: customerId,
		items: [{ price: tokenPriceId }],
		metadata: { shunkan_kind: "meter", ...(profileId ? { profileId } : {}) },
	});
}

function priceId(price: string | Stripe.Price | null | undefined): string | null {
	if (typeof price === "string") return price;
	return price?.id ?? null;
}

/**
 * Ledger balances come from each credit grant's Stripe balance summary.
 * Unbilled usage is the upcoming invoice's metered subtotal, which Stripe
 * has already priced. Monthly credit absorbs that usage first.
 */
export async function remainingCreditPools(customerId: string, now = Date.now()): Promise<CreditPools> {
	const hit = poolCache.get(customerId);
	if (hit && now - hit.at < POOL_TTL_MS) return hit.pools;
	const { stripe, prices } = billingRuntime();
	const grants = await listGrantSnapshots(stripe, customerId);
	let unbilled = 0;
	try {
		const preview = await stripe.invoices.createPreview({ customer: customerId });
		unbilled = meteredUsageCentavos(preview.lines.data.map((line) => ({
			priceId: invoiceLinePriceId(line),
			subtotalCentavos: line.subtotal,
		})), prices.tokenPriceId);
	} catch (err) {
		if (!isNoUpcomingInvoice(err)) throw err;
	}
	const pools = poolsFromGrants(grants, unbilled, Math.floor(now / 1000));
	poolCache.set(customerId, { at: now, pools });
	return pools;
}

async function listGrantSnapshots(stripe: Stripe, customerId: string): Promise<GrantSnapshot[]> {
	const snapshots: GrantSnapshot[] = [];
	let startingAfter: string | undefined;
	for (let page = 0; page < 5; page++) {
		const list = await stripe.billing.creditGrants.list({
			customer: customerId,
			limit: 100,
			...(startingAfter ? { starting_after: startingAfter } : {}),
		});
		for (const grant of list.data) {
			const kind = grantKind(grant);
			if (!kind || grant.voided_at) continue;
			const summary = await stripe.billing.creditBalanceSummaries.retrieve({
				customer: customerId,
				filter: { type: "credit_grant", credit_grant: grant.id },
			});
			snapshots.push({
				kind,
				availableCentavos: monetaryCentavos(summary),
				expiresAt: grant.expires_at,
				voided: false,
			});
		}
		if (!list.has_more) break;
		startingAfter = list.data[list.data.length - 1]?.id;
		if (!startingAfter) break;
	}
	return snapshots;
}

function grantKind(grant: Stripe.Billing.CreditGrant): GrantSnapshot["kind"] | null {
	const tagged = grant.metadata?.shunkan_kind;
	if (tagged === MONTHLY_GRANT_KIND || tagged === RECHARGE_GRANT_KIND) return tagged;
	if (grant.expires_at) return MONTHLY_GRANT_KIND;
	return RECHARGE_GRANT_KIND;
}

function monetaryCentavos(summary: Stripe.Billing.CreditBalanceSummary): number {
	let total = 0;
	for (const balance of summary.balances) {
		const monetary = balance.available_balance.monetary;
		if (balance.available_balance.type !== "monetary" || !monetary) continue;
		if (monetary.currency !== BILLING_CURRENCY) continue;
		if (Number.isFinite(monetary.value) && monetary.value > 0) total += monetary.value;
	}
	return total;
}

function isNoUpcomingInvoice(err: unknown): boolean {
	if (!err || typeof err !== "object") return false;
	if ("code" in err && err.code === "invoice_upcoming_none") return true;
	return err instanceof Error && /no upcoming invoices/i.test(err.message);
}

export function billingErrorResponse(err: unknown): Response {
	if (err instanceof UsersError || err instanceof BillingError) {
		return Response.json({ error: err.message }, { status: err.status });
	}
	console.error("billing request failed", err instanceof Error ? err.message : err);
	return Response.json({ error: "Billing request failed." }, { status: 500 });
}
