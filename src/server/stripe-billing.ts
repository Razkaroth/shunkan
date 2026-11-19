/**
 * Stripe Checkout, credit grants, and the balance read for the spend gate.
 * The gateway meter `token-billing-tokens` stays the usage record. Grants
 * pay the metered price on the same customer the profile already sends as
 * `stripe-customer-id`. This module does not keep a second ledger.
 */
import Stripe from "stripe";
import { readEnv } from "../../lib/env.ts";
import {
	BILLING_CURRENCY,
	type CreditPools,
	basicCheckoutBlocked,
	basicSubscriptionsToCancel,
	familySubscriptionFromStatuses,
	type BasicSubscriptionView,
	type FailedPayment,
	type FamilySubscription,
	type GrantSnapshot,
	invoiceLinePriceId,
	lastFailedPayment,
	meteredUsageCentavos,
	MONTHLY_GRANT_KIND,
	monthlyAllotmentCentavos,
	poolsFromGrants,
	RECHARGE_GRANT_KIND,
	rechargeCentavosFromMxn,
	rechargeGrantForPayment,
	resolveMonthlyGrant,
} from "../core/billing.ts";
import { isStripeCustomerId, type Profile } from "../core/users.ts";
import { readProfiles, writeProfiles } from "../store/users.ts";
import { readPlanTerms } from "./plan-terms.ts";
import { requestBoundProfile, UsersError } from "./users.ts";

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

async function requireProfile(req: Request): Promise<Profile> {
	const profile = await requestBoundProfile(req);
	if (!profile) throw new UsersError(401, "Choose a profile first.");
	if (!profile.ownerId) return profile;
	const customerId = familyCustomerId(profile.ownerId);
	return customerId ? { ...profile, stripeCustomerId: customerId } : profile;
}

/** Copy this customer onto every profile of the same account that does not already have one. */
export function bindProfileStripeCustomer(profileId: string, customerId: string): void {
	if (!isStripeCustomerId(customerId)) return;
	const profiles = readProfiles();
	const target = profiles.find((profile) => profile.id === profileId);
	if (!target) return;
	if (target.ownerId) {
		assignFamilyCustomer(target.ownerId, customerId);
		return;
	}
	if (target.stripeCustomerId) return;
	writeProfiles(profiles.map((profile) => (
		profile.id === profileId ? { ...profile, stripeCustomerId: customerId } : profile
	)));
}

function assignFamilyCustomer(ownerId: string, customerId: string): void {
	if (!isStripeCustomerId(customerId)) return;
	const profiles = readProfiles();
	let changed = false;
	const next = profiles.map((profile) => {
		if (profile.ownerId !== ownerId || profile.stripeCustomerId === customerId) return profile;
		changed = true;
		return { ...profile, stripeCustomerId: customerId };
	});
	if (changed) writeProfiles(next);
}

/** The one customer id for this account, written onto every one of its profiles. */
export function familyCustomerId(ownerId: string | undefined): string | undefined {
	if (!ownerId) return undefined;
	const chosen = readProfiles().find((profile) => profile.ownerId === ownerId && profile.stripeCustomerId)?.stripeCustomerId;
	if (!chosen) return undefined;
	assignFamilyCustomer(ownerId, chosen);
	return chosen;
}

/** One Stripe customer per Payload user, then copied onto each of that user's profiles. */
async function customerForProfile(stripe: Stripe, profile: Profile): Promise<string> {
	if (!profile.ownerId) throw new UsersError(403, "An operator attaches this profile to an account first.");
	const existing = familyCustomerId(profile.ownerId);
	const customerId = existing ?? (await stripe.customers.create({
		name: profile.name,
		metadata: { ownerId: profile.ownerId },
	}, { idempotencyKey: `shunkan_customer_${profile.ownerId}` })).id;
	assignFamilyCustomer(profile.ownerId, customerId);
	return customerId;
}

const SUBSCRIPTION_STATUSES = ["active", "past_due", "trialing", "unpaid", "paused", "incomplete", "canceled", "incomplete_expired"] as const;

async function listSubscriptions(
	stripe: Stripe,
	customerId: string,
	status: (typeof SUBSCRIPTION_STATUSES)[number],
): Promise<Stripe.Subscription[]> {
	const found: Stripe.Subscription[] = [];
	let startingAfter: string | undefined;
	for (let page = 0; page < 20; page++) {
		const listed = await stripe.subscriptions.list({
			customer: customerId,
			status,
			limit: 100,
			...(startingAfter ? { starting_after: startingAfter } : {}),
		});
		found.push(...listed.data);
		if (!listed.has_more) return found;
		startingAfter = listed.data[listed.data.length - 1]?.id;
		if (!startingAfter) return found;
	}
	throw new BillingError(503, "Stripe subscription list was incomplete.");
}

function subscriptionView(subscription: Stripe.Subscription): BasicSubscriptionView {
	return {
		id: subscription.id,
		created: subscription.created,
		status: subscription.status,
		priceIds: subscription.items.data.map((item) => priceId(item.price)).filter((id): id is string => id !== null),
	};
}

/** Cancel every live Basic subscription except the oldest. Returns that oldest id. */
async function keepOldestBasic(stripe: Stripe, customerId: string, basicPriceId: string): Promise<string | null> {
	const listed = [
		...(await listSubscriptions(stripe, customerId, "active")),
		...(await listSubscriptions(stripe, customerId, "past_due")),
	].map(subscriptionView);
	const cancel = new Set(basicSubscriptionsToCancel(listed, basicPriceId));
	for (const id of cancel) {
		try {
			await stripe.subscriptions.cancel(id);
		} catch (err) {
			const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
			if (code !== "resource_missing") throw err;
		}
	}
	const keeper = listed
		.filter((subscription) => subscription.priceIds.includes(basicPriceId) && !cancel.has(subscription.id))
		.sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1))[0];
	return keeper?.id ?? null;
}

export async function familySubscriptionStatus(customerId: string): Promise<FamilySubscription> {
	const { stripe, prices } = billingRuntime();
	const live = [
		...(await listSubscriptions(stripe, customerId, "past_due")),
		...(await listSubscriptions(stripe, customerId, "active")),
	].filter((subscription) => subscriptionView(subscription).priceIds.includes(prices.basicPriceId));
	const liveStatus = familySubscriptionFromStatuses(live.map((subscription) => subscription.status));
	if (liveStatus === "past_due" || liveStatus === "active") return liveStatus;
	for (const status of SUBSCRIPTION_STATUSES) {
		if (status === "active" || status === "past_due") continue;
		const listed = await listSubscriptions(stripe, customerId, status);
		if (listed.some((subscription) => subscriptionView(subscription).priceIds.includes(prices.basicPriceId))) return "canceled";
	}
	return "none";
}

export async function lastFailedFamilyPayment(customerId: string): Promise<FailedPayment | null> {
	const invoices = await billingRuntime().stripe.invoices.list({ customer: customerId, limit: 20 });
	return lastFailedPayment(invoices.data);
}

function appOrigin(): string {
	return readEnv().NEXT_PUBLIC_URL.replace(/\/$/, "");
}

export async function startBasicCheckout(req: Request): Promise<{ url: string }> {
	const profile = await requireProfile(req);
	const { stripe, prices } = billingRuntime();
	if (await readPlanTerms() === null) throw new BillingError(503, "The monthly price is not set.");
	const customer = await customerForProfile(stripe, profile);
	const live = [
		...(await listSubscriptions(stripe, customer, "active")),
		...(await listSubscriptions(stripe, customer, "past_due")),
	].map(subscriptionView);
	if (basicCheckoutBlocked(live, prices.basicPriceId)) {
		throw new BillingError(409, "This account already has a Basic subscription.");
	}
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
	const profile = await requireProfile(req);
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
	/** Null until an admin sets both pricing fields. */
	basicPlanCentavos: number | null;
	/** Null until an admin sets both pricing fields. Zero is a configured commission of zero. */
	monthlyAllotmentCentavos: number | null;
	payAsYouGo: boolean;
	hasCustomer: boolean;
	monthlyCentavos: number;
	rechargeCentavos: number;
}

export async function billingStatus(req: Request, payAsYouGo: boolean): Promise<BillingStatus> {
	const profile = await requireProfile(req);
	const terms = await readPlanTerms();
	const base: BillingStatus = {
		configured: billingPrices() !== null && Boolean(process.env.STRIPE_BILLING_RESTRICTED_KEY?.trim()),
		currency: BILLING_CURRENCY,
		basicPlanCentavos: terms?.monthlyPriceCentavos ?? null,
		monthlyAllotmentCentavos: terms === null ? null : monthlyAllotmentCentavos(terms),
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
	const decision = resolveMonthlyGrant({
		id: invoice.id ?? "",
		currency: invoice.currency,
		billingReason: invoice.billing_reason,
		amountPaidCentavos: invoice.amount_paid,
		hasBasicPrice: basic !== undefined,
		periodStart: basic?.periodStart ?? null,
		periodEnd: basic?.periodEnd ?? null,
	}, await readPlanTerms());
	const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
	const profileId = invoice.parent?.subscription_details?.metadata?.profileId ?? invoice.metadata?.profileId ?? null;
	if (customerId && profileId) bindProfileStripeCustomer(profileId, customerId);
	if (customerId && basic) {
		const keeper = await keepOldestBasic(stripe, customerId, prices.basicPriceId);
		const subscriptionId = invoiceSubscriptionId(invoice);
		if (subscriptionId && keeper && subscriptionId !== keeper) return;
	}
	if (decision.action === "wait") throw new BillingError(503, "The monthly price is not set.");
	if (decision.action !== "grant" || !customerId) return;
	const spec = decision.spec;
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
	const { stripe, prices } = billingRuntime();
	if (session.mode === "subscription" && customerId) await keepOldestBasic(stripe, customerId, prices.basicPriceId);
	if (session.mode !== "payment") return;
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
	const open = [
		...(await listSubscriptions(stripe, customerId, "active")),
		...(await listSubscriptions(stripe, customerId, "trialing")),
		...(await listSubscriptions(stripe, customerId, "past_due")),
	];
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

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
	const subscription = invoice.parent?.subscription_details?.subscription;
	if (typeof subscription === "string") return subscription;
	return subscription?.id ?? null;
}

export async function startBillingPortal(req: Request): Promise<{ url: string }> {
	const profile = await requireProfile(req);
	if (!profile.stripeCustomerId) throw new BillingError(409, "Subscribe before opening the billing portal.");
	const session = await billingRuntime().stripe.billingPortal.sessions.create({
		customer: profile.stripeCustomerId,
		return_url: `${appOrigin()}/chat/new`,
	});
	if (!session.url) throw new BillingError(502, "Stripe did not return a portal URL.");
	return { url: session.url };
}

export interface FamilyBillingRow {
	ownerId: string;
	profiles: { id: string; name: string }[];
	subscription: FamilySubscription | "unconfigured" | "unavailable";
	remaining: CreditPools | null;
	creditUnavailable: boolean;
	lastFailedPayment: FailedPayment | null;
	paymentUnavailable: boolean;
}

/** Product-admin view. Status, remaining credit, and the last failed payment are read from Stripe. */
export async function familyBillingReport(req: Request): Promise<FamilyBillingRow[]> {
	const profile = await requireProfile(req);
	if (profile.role !== "admin") throw new UsersError(403, "Only the admin can see family billing.");
	const groups = new Map<string, Profile[]>();
	for (const item of readProfiles()) {
		if (!item.ownerId) continue;
		const members = groups.get(item.ownerId) ?? [];
		members.push(item);
		groups.set(item.ownerId, members);
	}
	const configured = billingPrices() !== null && Boolean(process.env.STRIPE_BILLING_RESTRICTED_KEY?.trim());
	const rows: FamilyBillingRow[] = [];
	for (const [ownerId, members] of groups) {
		const customerId = familyCustomerId(ownerId) ?? members.find((member) => member.stripeCustomerId)?.stripeCustomerId;
		const row: FamilyBillingRow = {
			ownerId,
			profiles: members.map((member) => ({ id: member.id, name: member.name })),
			subscription: configured && customerId ? "none" : "unconfigured",
			remaining: null,
			creditUnavailable: false,
			lastFailedPayment: null,
			paymentUnavailable: false,
		};
		if (!configured || !customerId) {
			rows.push(row);
			continue;
		}
		let subscription = row.subscription;
		let remaining: CreditPools | null = null;
		let lastFailedPayment: FailedPayment | null = null;
		let creditUnavailable = false;
		let paymentUnavailable = false;
		try {
			subscription = await familySubscriptionStatus(customerId);
		} catch (err) {
			console.warn("family subscription could not be read", err instanceof Error ? err.message : err);
			subscription = "unavailable";
		}
		try {
			remaining = await remainingCreditPools(customerId);
		} catch (err) {
			console.warn("family credit could not be read", err instanceof Error ? err.message : err);
			creditUnavailable = true;
		}
		try {
			lastFailedPayment = await lastFailedFamilyPayment(customerId);
		} catch (err) {
			console.warn("family payment could not be read", err instanceof Error ? err.message : err);
			paymentUnavailable = true;
		}
		rows.push({ ...row, subscription, remaining, creditUnavailable, lastFailedPayment, paymentUnavailable });
	}
	return rows;
}

export function billingErrorResponse(err: unknown): Response {
	if (err instanceof UsersError || err instanceof BillingError) {
		return Response.json({ error: err.message }, { status: err.status });
	}
	console.error("billing request failed", err instanceof Error ? err.message : err);
	return Response.json({ error: "Billing request failed." }, { status: 500 });
}
