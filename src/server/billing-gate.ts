/**
 * Installed when the server barrel loads. An active profile with no Stripe
 * customer blocks the model call. When billing keys are absent the rest of the check is
 * skipped, so a local install is not newly blocked once a customer exists.
 * When keys are present, the call is allowed only while the subscription is
 * active and the credit decision allows it. Past due, canceled, and no
 * subscription block even if pay as you go is on.
 */
import { activeUserId } from "../../config.ts";
import { configureSpendGuard, gatewayCustomerId } from "../agent/gateway-provision.ts";
import { decideSpend, SpendBlockedError, subscriptionAllowsSpend, type FamilySubscription } from "../core/billing.ts";
import { payAsYouGoEnabled } from "./feature-flags.ts";
import { familySubscriptionStatus, remainingCreditPools } from "./stripe-billing.ts";

configureSpendGuard(async () => {
	const customerId = gatewayCustomerId();
	if (activeUserId() && !customerId) throw new SpendBlockedError();
	const meters = Boolean(process.env.STRIPE_RESTRICTED_ACCESS_KEY?.trim());
	const bills = Boolean(process.env.STRIPE_BILLING_RESTRICTED_KEY?.trim());
	if (!customerId || !meters || !bills) return;
	let status: FamilySubscription;
	try {
		status = await familySubscriptionStatus(customerId);
	} catch (err) {
		console.warn("spend gate could not read the subscription", err instanceof Error ? err.message : err);
		throw new SpendBlockedError();
	}
	if (!subscriptionAllowsSpend(status)) throw new SpendBlockedError();
	const payAsYouGo = await payAsYouGoEnabled();
	let pools: { monthlyCentavos: number; rechargeCentavos: number };
	try {
		pools = await remainingCreditPools(customerId);
	} catch (err) {
		console.warn("credit balance could not be read", err instanceof Error ? err.message : err);
		if (payAsYouGo) return;
		throw new SpendBlockedError();
	}
	const decision = decideSpend(pools, payAsYouGo);
	if (!decision.allow) throw new SpendBlockedError();
});
