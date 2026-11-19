/**
 * Family closed beta: one account owns its profiles, plugin checkboxes
 * default off, Stripe status is a pure read, and a learner image is
 * private to the profile that stored it.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "lh-family-"));
process.env.LH_DATA_DIR = ROOT;

const { LearnerImages } = await import("../collections/LearnerImages.ts");
const { Plugins } = await import("../globals/Plugins.ts");
const billing = await import("../src/core/billing.ts");
const images = await import("../src/server/learner-images.ts");
const plugins = await import("../src/server/plugins.ts");
const users = await import("../src/server/users.ts");
const stripe = await import("../src/server/stripe-billing.ts");
const { mintUserId, readProfiles, writeProfiles } = await import("../src/store/users.ts");
const keys = await import("../app/api/keys/route.ts");

after(() => {
	plugins.resetPluginAllowlist();
	images.resetLearnerImageStore();
	fs.rmSync(ROOT, { recursive: true, force: true });
});

function cookie(sessionId: string): Request {
	return new Request("http://localhost/api/keys", {
		headers: { cookie: `${users.SESSION_COOKIE}=${encodeURIComponent(sessionId)}` },
	});
}

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("family closed beta", () => {
	it("ships three plugin checkboxes, off until an admin checks them", async () => {
		assert.equal(Plugins.slug, "plugins");
		assert.deepEqual(Plugins.fields.map((field) => "name" in field ? field.name : ""), ["flashcards", "drawingPad", "richCodeBlocks"]);
		assert.ok(Plugins.fields.every((field) => "defaultValue" in field && field.defaultValue === false));
		plugins.configurePluginAllowlist(async () => ({ flashcards: true, drawingPad: false, richCodeBlocks: true }));
		await assert.rejects(
			() => plugins.setHouseholdPlugin("parent_ada", "drawingPad", true),
			(err: unknown) => err instanceof users.UsersError && err.status === 403,
		);
		const enabled = await plugins.setHouseholdPlugin("parent_ada", "flashcards", true);
		assert.equal(enabled.flashcards, true);
		assert.equal(enabled.drawingPad, false);
		assert.equal(enabled.richCodeBlocks, false);
		assert.equal(await plugins.pluginEnabled("parent_ada", "richCodeBlocks"), false);
	});

	it("reads subscription status and the last failed payment without storing them", () => {
		assert.equal(billing.familySubscriptionFromStatuses([]), "none");
		assert.equal(billing.familySubscriptionFromStatuses(["canceled", "past_due", "active"]), "past_due");
		assert.equal(billing.familySubscriptionFromStatuses(["canceled", "active"]), "active");
		assert.equal(billing.familySubscriptionFromStatuses(["canceled", "incomplete_expired"]), "canceled");
		assert.equal(billing.subscriptionAllowsSpend("active"), true);
		assert.equal(billing.subscriptionAllowsSpend("past_due"), false);
		assert.equal(billing.subscriptionAllowsSpend("canceled"), false);
		assert.equal(billing.subscriptionAllowsSpend("none"), false);
		assert.equal(billing.secondBasicCheckoutRefused("active"), true);
		assert.equal(billing.secondBasicCheckoutRefused("past_due"), true);
		assert.equal(billing.secondBasicCheckoutRefused("canceled"), false);
		assert.equal(billing.secondBasicCheckoutRefused("none"), false);
		const basic = { id: "sub_basic", created: 1, status: "active", priceIds: ["price_basic"] };
		const meter = { id: "sub_meter", created: 2, status: "active", priceIds: ["price_token"] };
		const newer = { id: "sub_newer", created: 3, status: "past_due", priceIds: ["price_basic", "price_token"] };
		assert.equal(billing.basicCheckoutBlocked([meter], "price_basic"), false);
		assert.equal(billing.basicCheckoutBlocked([basic], "price_basic"), true);
		assert.deepEqual(billing.basicSubscriptionsToCancel([newer, basic, meter], "price_basic"), ["sub_newer"]);
		const failed = billing.lastFailedPayment([
			{ id: "in_new", attempted: true, paid: false, status: "open", amount_due: 8000, currency: "mxn", created: 2 },
			{ id: "in_old", attempted: true, paid: false, status: "open", amount_due: 100, currency: "mxn", created: 1 },
		]);
		assert.equal(failed?.invoiceId, "in_new");
		assert.equal(billing.lastFailedPayment([{ id: "in_paid", attempted: true, paid: true, status: "paid", amount_due: 8000, currency: "mxn", created: 3 }]), null);
	});

	it("copies one customer onto every profile of that account and drops a bad owner id", () => {
		const ada = users.createProfile(undefined, { name: "Ada", color: "teal" }, "parent_ada");
		stripe.bindProfileStripeCustomer(ada.profile.id, "cus_familybeta");
		const bo = users.createProfile(cookie(ada.sessionId!), { name: "Bo", color: "sky" }, "parent_ada");
		const profiles = readProfiles();
		assert.equal(profiles.find((profile) => profile.id === ada.profile.id)?.stripeCustomerId, "cus_familybeta");
		assert.equal(profiles.find((profile) => profile.id === bo.profile.id)?.stripeCustomerId, "cus_familybeta");
		writeProfiles(readProfiles().map((profile) => (
			profile.id === bo.profile.id ? { ...profile, stripeCustomerId: "cus_otherfamily" } : profile
		)));
		stripe.bindProfileStripeCustomer(ada.profile.id, "cus_familybeta");
		assert.equal(readProfiles().find((profile) => profile.id === bo.profile.id)?.stripeCustomerId, "cus_familybeta");
		writeProfiles([...readProfiles(), {
			id: mintUserId(),
			name: "Loose",
			color: "amber",
			role: "member",
			ownerId: "../not-an-id",
			createdAt: "2026-11-18T00:00:00.000Z",
		}]);
		assert.equal(readProfiles().find((profile) => profile.name === "Loose")?.ownerId, undefined);
	});

	it("keeps a learner image private to the profile that stored it", async () => {
		assert.equal(LearnerImages.slug, "learner-images");
		assert.equal(LearnerImages.fields[0] && "name" in LearnerImages.fields[0] ? LearnerImages.fields[0].name : "", "profileId");
		images.configureLearnerImageStore("memory");
		const id = await images.saveLearnerImage("usr_ada", PNG, "image/png");
		const own = await images.readLearnerImage("usr_ada", id);
		assert.equal(own?.profileId, "usr_ada");
		assert.equal(own?.mimeType, "image/png");
		assert.equal(await images.readLearnerImage("usr_bo", id), null);
	});

	it("returns key material only to the product admin", async () => {
		const open = await keys.GET(new Request("http://localhost/api/keys"));
		assert.equal(open.status, 401, "a claimed install does not list keys without a profile");
		const ada = readProfiles().find((profile) => profile.role === "admin");
		assert.ok(ada);
		const sessions = JSON.parse(fs.readFileSync(path.join(ROOT, "sessions.json"), "utf8")) as Record<string, { userId: string }>;
		const adminSession = Object.entries(sessions).find(([, entry]) => entry.userId === ada.id)?.[0];
		assert.ok(adminSession);
		const adminBody = await (await keys.GET(cookie(adminSession))).json() as { keys: unknown[] };
		assert.ok(adminBody.keys.length > 0);
		const bo = readProfiles().find((profile) => profile.name === "Bo");
		assert.ok(bo);
		const memberSession = users.unlockProfile(bo.id, undefined, "parent_ada");
		const memberBody = await (await keys.GET(cookie(memberSession))).json() as { keys: unknown[] };
		assert.deepEqual(memberBody.keys, []);
	});
});
