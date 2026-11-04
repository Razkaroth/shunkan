/**
 * Installed when the server barrel loads. A model call that would emit
 * `token-billing-tokens` is allowed only after the credit decision:
 * monthly allotment, then recharge, then pay as you go when the
 * `feature-flags` global says so. The flag is read in `payAsYouGoEnabled`.
 * With the flag off and both pools empty, the call is not sent, so Stripe
 * is not asked to bill it.
 */
import { configureSpendGuard, gatewayCustomerId } from "../agent/gateway-provision.ts";
import { decideSpend, SpendBlockedError } from "../core/billing.ts";
import { payAsYouGoEnabled } from "./feature-flags.ts";
import { remainingCreditPools } from "./stripe-billing.ts";

configureSpendGuard(async () => {
	const customerId = gatewayCustomerId();
	const meters = Boolean(process.env.STRIPE_RESTRICTED_ACCESS_KEY?.trim());
	const bills = Boolean(process.env.STRIPE_BILLING_RESTRICTED_KEY?.trim());
	if (!customerId || !meters || !bills) return;
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
