import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FeatureFlags } from "../globals/FeatureFlags.ts";
import { Pricing } from "../globals/Pricing.ts";
import {
	BILLING_CURRENCY,
	MONTHLY_GRANT_GRACE_SECONDS,
	MONTHLY_GRANT_PRIORITY,
	RECHARGE_GRANT_PRIORITY,
	decideSpend,
	invoiceLinePriceId,
	meteredUsageCentavos,
	monthlyAllotmentCentavos,
	payAsYouGoFromFlags,
	planTermsFromPricing,
	poolsFromGrants,
	rechargeCentavosFromMxn,
	rechargeGrantForPayment,
	remainingAfterUsage,
	resolveMonthlyGrant,
} from "../src/core/billing.ts";

const NOW = 1_700_000_000;

const CONFIGURED = { monthlyPriceCentavos: 8_000, commissionPercent: 25 };

describe("pricing credit decision", () => {
	test("the pricing global is two numbers and an empty global is not a price", () => {
		assert.equal(Pricing.slug, "pricing");
		assert.equal(Pricing.fields.length, 2);
		const price = Pricing.fields[0];
		const commission = Pricing.fields[1];
		assert.ok(price && commission);
		assert.equal(price.type, "number");
		assert.equal(commission.type, "number");
		assert.equal("name" in price && price.name, "monthlyPriceMxn");
		assert.equal("name" in commission && commission.name, "commissionPercent");
		assert.equal("defaultValue" in price ? price.defaultValue : undefined, undefined);
		assert.equal("defaultValue" in commission ? commission.defaultValue : undefined, undefined);
		assert.equal(BILLING_CURRENCY, "mxn");
		assert.equal(planTermsFromPricing(null), null);
		assert.equal(planTermsFromPricing({}), null);
		assert.equal(planTermsFromPricing({ monthlyPriceMxn: 80 }), null);
		assert.equal(planTermsFromPricing({ commissionPercent: 25 }), null);
		assert.equal(planTermsFromPricing({ monthlyPriceMxn: 0, commissionPercent: 25 }), null);
		assert.equal(planTermsFromPricing({ monthlyPriceMxn: 80, commissionPercent: 101 }), null);
		const terms = planTermsFromPricing({ monthlyPriceMxn: 80, commissionPercent: 25 });
		assert.deepEqual(terms, CONFIGURED);
		assert.equal(terms && monthlyAllotmentCentavos(terms), 2_000);
	});

	test("monthly credit is spent before recharge, then pay as you go, then a block", () => {
		assert.deepEqual(decideSpend({ monthlyCentavos: 10, rechargeCentavos: 10 }, false), { allow: true, source: "monthly" });
		assert.deepEqual(decideSpend({ monthlyCentavos: 0, rechargeCentavos: 10 }, false), { allow: true, source: "recharge" });
		assert.deepEqual(decideSpend({ monthlyCentavos: 0, rechargeCentavos: 0 }, true), { allow: true, source: "payg" });
		assert.deepEqual(decideSpend({ monthlyCentavos: 0, rechargeCentavos: 0 }, false), { allow: false, source: "blocked" });
	});

	test("unbilled usage consumes the monthly allotment before recharge", () => {
		assert.deepEqual(remainingAfterUsage({ monthlyCentavos: 8_000, rechargeCentavos: 5_000 }, 2_000), {
			monthlyCentavos: 6_000,
			rechargeCentavos: 5_000,
		});
		assert.deepEqual(remainingAfterUsage({ monthlyCentavos: 1_000, rechargeCentavos: 5_000 }, 2_500), {
			monthlyCentavos: 0,
			rechargeCentavos: 3_500,
		});
		assert.deepEqual(decideSpend(remainingAfterUsage({ monthlyCentavos: 100, rechargeCentavos: 100 }, 200), false), {
			allow: false,
			source: "blocked",
		});
		assert.deepEqual(decideSpend(remainingAfterUsage({ monthlyCentavos: 100, rechargeCentavos: 100 }, 200), true), {
			allow: true,
			source: "payg",
		});
	});

	test("a monthly grant is not spendable after its period, and an expired recharge is gone", () => {
		const periodEnd = NOW - 10;
		const pools = poolsFromGrants([
			{ kind: "monthly", availableCentavos: 8_000, expiresAt: periodEnd + MONTHLY_GRANT_GRACE_SECONDS, voided: false },
			{ kind: "recharge", availableCentavos: 4_000, expiresAt: NOW - 1, voided: false },
			{ kind: "recharge", availableCentavos: 9_000, expiresAt: null, voided: true },
			{ kind: "recharge", availableCentavos: 3_000, expiresAt: null, voided: false },
		], 500, NOW);
		assert.deepEqual(pools, { monthlyCentavos: 0, rechargeCentavos: 2_500 });
	});

	test("a paid Basic invoice grants the commission share of the configured price", () => {
		const invoice = {
			id: "in_basic",
			currency: "mxn",
			billingReason: "subscription_cycle",
			amountPaidCentavos: 9_000,
			hasBasicPrice: true,
			periodStart: NOW,
			periodEnd: NOW + 2_592_000,
		};
		const decision = resolveMonthlyGrant(invoice, CONFIGURED);
		assert.equal(decision.action, "grant");
		if (decision.action !== "grant") return;
		assert.equal(decision.spec.amountCentavos, 2_000);
		assert.equal(decision.spec.priority, MONTHLY_GRANT_PRIORITY);
		assert.equal(decision.spec.expiresAt, NOW + 2_592_000 + MONTHLY_GRANT_GRACE_SECONDS);
		assert.equal(decision.spec.metadata.basic_centavos, "8000");
		assert.equal(decision.spec.metadata.allotment_centavos, "2000");
		assert.equal(decision.spec.idempotencyKey, "shunkan_monthly_in_basic");
		assert.deepEqual(resolveMonthlyGrant({ ...invoice, hasBasicPrice: false }, CONFIGURED), { action: "ignore" });
		assert.deepEqual(resolveMonthlyGrant(invoice, null), { action: "wait" });
		assert.deepEqual(resolveMonthlyGrant({ ...invoice, amountPaidCentavos: 1_000 }, CONFIGURED), { action: "ignore" });
		assert.deepEqual(resolveMonthlyGrant(invoice, { monthlyPriceCentavos: 8_000, commissionPercent: 0 }), { action: "ignore" });
	});

	test("a paid recharge grants the full amount and does not expire", () => {
		const grant = rechargeGrantForPayment({
			id: "cs_recharge",
			kind: "recharge",
			paymentStatus: "paid",
			currency: "mxn",
			amountCentavos: 4_000,
		});
		assert.ok(grant);
		assert.equal(grant.amountCentavos, 4_000);
		assert.equal(grant.priority, RECHARGE_GRANT_PRIORITY);
		assert.equal("expiresAt" in grant, false);
		assert.equal(rechargeGrantForPayment({
			id: "cs_open",
			kind: "recharge",
			paymentStatus: "unpaid",
			currency: "mxn",
			amountCentavos: 4_000,
		}), null);
		assert.equal(rechargeCentavosFromMxn(40), 4_000);
		assert.equal(rechargeCentavosFromMxn(40.5), null);
	});

	test("metered usage is the token price subtotal", () => {
		assert.equal(invoiceLinePriceId({ pricing: { price_details: { price: "price_token" } } }), "price_token");
		assert.equal(meteredUsageCentavos([
			{ priceId: "price_basic", subtotalCentavos: 8_000 },
			{ priceId: "price_token", subtotalCentavos: 2_000 },
		], "price_token"), 2_000);
	});

	test("the feature-flag global is one checkbox and pay as you go defaults off", () => {
		assert.equal(FeatureFlags.slug, "feature-flags");
		assert.equal(FeatureFlags.fields.length, 1);
		const flag = FeatureFlags.fields[0];
		assert.ok(flag);
		assert.equal(flag.type, "checkbox");
		assert.equal("name" in flag && flag.name, "payAsYouGo");
		assert.equal("defaultValue" in flag && flag.defaultValue, false);
		assert.equal(payAsYouGoFromFlags({ payAsYouGo: false }), false);
		assert.equal(payAsYouGoFromFlags({ payAsYouGo: true }), true);
		assert.equal(payAsYouGoFromFlags(null), false);
	});
});
