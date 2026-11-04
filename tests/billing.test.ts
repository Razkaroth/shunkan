import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FeatureFlags } from "../globals/FeatureFlags.ts";
import {
	BASIC_PLAN_CENTAVOS,
	BILLING_CURRENCY,
	MONTHLY_ALLOTMENT_CENTAVOS,
	MONTHLY_GRANT_GRACE_SECONDS,
	MONTHLY_GRANT_PRIORITY,
	RECHARGE_GRANT_PRIORITY,
	decideSpend,
	invoiceLinePriceId,
	meteredUsageCentavos,
	monthlyGrantForInvoice,
	payAsYouGoFromFlags,
	poolsFromGrants,
	rechargeCentavosFromMxn,
	rechargeGrantForPayment,
	remainingAfterUsage,
} from "../src/core/billing.ts";

const NOW = 1_700_000_000;

describe("pricing credit decision", () => {
	test("half of the 150 MXN plan is the monthly allotment", () => {
		assert.equal(BASIC_PLAN_CENTAVOS, 15_000);
		assert.equal(MONTHLY_ALLOTMENT_CENTAVOS, 7_500);
		assert.equal(BILLING_CURRENCY, "mxn");
	});

	test("monthly credit is spent before recharge, then pay as you go, then a block", () => {
		assert.deepEqual(decideSpend({ monthlyCentavos: 10, rechargeCentavos: 10 }, false), { allow: true, source: "monthly" });
		assert.deepEqual(decideSpend({ monthlyCentavos: 0, rechargeCentavos: 10 }, false), { allow: true, source: "recharge" });
		assert.deepEqual(decideSpend({ monthlyCentavos: 0, rechargeCentavos: 0 }, true), { allow: true, source: "payg" });
		assert.deepEqual(decideSpend({ monthlyCentavos: 0, rechargeCentavos: 0 }, false), { allow: false, source: "blocked" });
	});

	test("unbilled usage consumes the monthly allotment before recharge", () => {
		assert.deepEqual(remainingAfterUsage({ monthlyCentavos: 7_500, rechargeCentavos: 5_000 }, 2_000), {
			monthlyCentavos: 5_500,
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
			{ kind: "monthly", availableCentavos: 7_500, expiresAt: periodEnd + MONTHLY_GRANT_GRACE_SECONDS, voided: false },
			{ kind: "recharge", availableCentavos: 4_000, expiresAt: NOW - 1, voided: false },
			{ kind: "recharge", availableCentavos: 9_000, expiresAt: null, voided: true },
			{ kind: "recharge", availableCentavos: 3_000, expiresAt: null, voided: false },
		], 500, NOW);
		assert.deepEqual(pools, { monthlyCentavos: 0, rechargeCentavos: 2_500 });
	});

	test("a paid Basic invoice grants exactly half", () => {
		const grant = monthlyGrantForInvoice({
			id: "in_basic",
			currency: "mxn",
			billingReason: "subscription_cycle",
			amountPaidCentavos: 18_000,
			hasBasicPrice: true,
			periodStart: NOW,
			periodEnd: NOW + 2_592_000,
		});
		assert.ok(grant);
		assert.equal(grant.amountCentavos, 7_500);
		assert.equal(grant.priority, MONTHLY_GRANT_PRIORITY);
		assert.equal(grant.expiresAt, NOW + 2_592_000 + MONTHLY_GRANT_GRACE_SECONDS);
		assert.equal(grant.metadata.allotment_centavos, "7500");
		assert.equal(grant.idempotencyKey, "shunkan_monthly_in_basic");
		assert.equal(monthlyGrantForInvoice({
			id: "in_usage",
			currency: "mxn",
			billingReason: "subscription_cycle",
			amountPaidCentavos: 18_000,
			hasBasicPrice: false,
			periodStart: NOW,
			periodEnd: NOW + 10,
		}), null);
	});

	test("a paid recharge grants the full amount and does not expire", () => {
		const grant = rechargeGrantForPayment({
			id: "cs_recharge",
			kind: "recharge",
			paymentStatus: "paid",
			currency: "mxn",
			amountCentavos: 15_000,
		});
		assert.ok(grant);
		assert.equal(grant.amountCentavos, 15_000);
		assert.equal(grant.priority, RECHARGE_GRANT_PRIORITY);
		assert.equal("expiresAt" in grant, false);
		assert.equal(rechargeGrantForPayment({
			id: "cs_open",
			kind: "recharge",
			paymentStatus: "unpaid",
			currency: "mxn",
			amountCentavos: 15_000,
		}), null);
		assert.equal(rechargeCentavosFromMxn(150), 15_000);
		assert.equal(rechargeCentavosFromMxn(150.5), null);
	});

	test("metered usage is the token price subtotal", () => {
		assert.equal(invoiceLinePriceId({ pricing: { price_details: { price: "price_token" } } }), "price_token");
		assert.equal(meteredUsageCentavos([
			{ priceId: "price_basic", subtotalCentavos: 15_000 },
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
