/**
 * Multi-user profiles (2026-10-27): path resolution per profile, the
 * first-profile claim, the withUser gate, the PIN gate, restricted
 * sign-ups, who may edit and delete, and the per-profile event channel.
 *
 * One isolated LH_DATA_DIR for the whole file, set BEFORE config.ts loads;
 * the tests run in order because each builds on the install state the
 * previous one left (unclaimed → claimed → more profiles).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "lh-users-"));
process.env.LH_DATA_DIR = ROOT;

const config = await import("../config.ts");
const users = await import("../src/server/users.ts");
const { eventsResponse } = await import("../src/server/events-stream.ts");
const { emit } = await import("../src/core/events.ts");

after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function reqAs(sessionId: string | null): Request {
	return new Request("http://localhost/api/x", {
		headers: sessionId ? { cookie: `other=1; ${users.SESSION_COOKIE}=${sessionId}` } : {},
	});
}

function refusal(fn: () => unknown, status: number) {
	assert.throws(fn, (err: unknown) => err instanceof users.UsersError && err.status === status);
}

const whoAmI = users.withUser(async (_req: Request) =>
	Response.json({ user: config.activeUserId() ?? null, data: config.PATHS.data }),
);

let adminId = "";
let adminSession = "";
let memberId = "";
let memberSession = "";
const OWNER = "parent_ada";
const OTHER = "parent_bee";

describe("multi-user profiles", () => {
	it("an unclaimed install resolves learner paths at the root and withUser passes through", async () => {
		assert.equal(config.learnerRoot(), ROOT);
		assert.equal(config.PATHS.chats, path.join(ROOT, "chats"));
		const body = (await (await whoAmI(reqAs(null))).json()) as { user: string | null; data: string };
		assert.deepEqual(body, { user: null, data: ROOT });
		assert.equal(users.usersSnapshot(undefined, OWNER).canSignUp, true, "zero profiles = anyone may create the first");
	});

	it("the first profile is the admin and claims the existing learner records", () => {
		fs.mkdirSync(path.join(ROOT, "chats"), { recursive: true });
		fs.writeFileSync(path.join(ROOT, "chats", "c1.json"), "{}");
		fs.writeFileSync(path.join(ROOT, "settings.json"), "{}");
		fs.writeFileSync(path.join(ROOT, "models-cache.json"), "{}");
		assert.equal(users.usersSnapshot(undefined, OWNER).existingData, true);

		const { profile, sessionId } = users.createProfile(undefined, { name: "  Ada   Lovelace ", color: "teal", pin: null }, OWNER);
		assert.equal(profile.role, "admin");
		assert.equal(profile.name, "Ada Lovelace");
		assert.ok(sessionId, "creating from the select screen signs in");
		adminId = profile.id;
		adminSession = sessionId;
		const stored = JSON.parse(fs.readFileSync(config.INSTALL.users, "utf8")) as { profiles: { ownerId?: string }[] };
		assert.equal(stored.profiles[0]?.ownerId, OWNER);

		const dir = config.userDataDir(adminId);
		assert.ok(fs.existsSync(path.join(dir, "chats", "c1.json")));
		assert.ok(fs.existsSync(path.join(dir, "settings.json")));
		assert.ok(!fs.existsSync(path.join(ROOT, "chats")), "learner entries moved, not copied");
		assert.ok(fs.existsSync(path.join(ROOT, "models-cache.json")), "install-wide files stay at the root");
		assert.ok(fs.existsSync(config.INSTALL.users));
		assert.equal(users.usersSnapshot(undefined, OWNER).existingData, false);
	});

	it("once claimed, the server layer still loads with no profile active (the /api/users routes import it)", async () => {
		await import("../src/server/index.ts");
	});

	it("once claimed, learner paths need an active profile and resolve into its folder", () => {
		assert.throws(() => config.PATHS.data, config.NoActiveUserError);
		config.runAsUser(adminId, () => {
			assert.equal(config.PATHS.chats, path.join(ROOT, "users", adminId, "chats"));
			assert.equal(config.settingsFile(), path.join(ROOT, "users", adminId, "settings.json"));
		});
		assert.throws(() => config.userDataDir("../escape"), "user ids are validated before they touch a path");
	});

	it("withUser refuses a request without a valid session and runs a valid one as its profile", async () => {
		const anon = await whoAmI(reqAs(null));
		assert.equal(anon.status, 401);
		assert.equal((await whoAmI(reqAs("not-a-session"))).status, 401);
		const ok = await whoAmI(reqAs(adminSession));
		assert.equal(ok.status, 200);
		assert.deepEqual(await ok.json(), { user: adminId, data: config.userDataDir(adminId) });
	});

	it("background work started inside a request keeps the profile", async () => {
		const later = config.runAsUser(adminId, () => new Promise<string | undefined>((resolve) => setTimeout(() => resolve(config.activeUserId()), 5)));
		assert.equal(await later, adminId);
	});

	it("names are trimmed, capped, and unique regardless of case", () => {
		refusal(() => users.createProfile(reqAs(adminSession), { name: "ada lovelace", color: "rose" }, OWNER), 400);
		refusal(() => users.createProfile(reqAs(adminSession), { name: "   ", color: "rose" }, OWNER), 400);
		refusal(() => users.createProfile(reqAs(adminSession), { name: "x".repeat(33), color: "rose" }, OWNER), 400);
		refusal(() => users.createProfile(reqAs(adminSession), { name: "Bo", color: "magenta" }, OWNER), 400);
	});

	it("the PIN gate: an admin-added profile with a PIN opens only with that PIN", () => {
		refusal(() => users.createProfile(reqAs(adminSession), { name: "Bo", color: "sky", pin: "12" }, OWNER), 400);
		const { profile, sessionId } = users.createProfile(reqAs(adminSession), { name: "Bo", color: "sky", pin: "1234" }, OWNER);
		assert.equal(sessionId, null, "the admin adding someone stays signed in as the admin");
		assert.equal(profile.role, "member");
		assert.equal(profile.hasPin, true);
		assert.ok(!("pin" in profile), "the public shape never carries the PIN");
		assert.ok(fs.existsSync(config.userDataDir(profile.id)));
		memberId = profile.id;

		refusal(() => users.unlockProfile(memberId, "0000", OWNER), 401);
		refusal(() => users.unlockProfile(memberId, undefined, OWNER), 401);
		refusal(() => users.unlockProfile(memberId, undefined, OTHER), 403);
		refusal(() => users.unlockProfile("usr_missing", "1234", OWNER), 404);
		memberSession = users.unlockProfile(memberId, "1234", OWNER);
		assert.equal(users.sessionProfileId(memberSession), memberId);
	});

	it("everyone edits themselves; only the admin edits others", () => {
		const renamed = users.updateProfile(reqAs(memberSession), memberId, { name: "Bobby", color: "lime" });
		assert.equal(renamed.name, "Bobby");
		assert.equal(renamed.hasPin, true, "an omitted PIN is left as is");
		refusal(() => users.updateProfile(reqAs(memberSession), adminId, { name: "Hacked" }), 403);
		refusal(() => users.updateProfile(reqAs(null), memberId, { name: "Anon" }), 401);

		assert.equal(users.updateProfile(reqAs(adminSession), memberId, { pin: null }).hasPin, false);
		refusal(() => users.unlockProfile(memberId, undefined, OTHER), 403);
		assert.equal(users.unlockProfile(memberId, "anything", OWNER).length > 0, true, "no PIN still requires this account");
		assert.equal(users.updateProfile(reqAs(memberSession), memberId, { pin: "5678" }).hasPin, true);
	});

	it("restricted sign-ups: only the admin toggles it; it hides self sign-up but not admin adds", () => {
		refusal(() => users.setRestrictedSignups(reqAs(memberSession), true), 403);
		refusal(() => users.setRestrictedSignups(reqAs(adminSession), "yes"), 400);
		users.setRestrictedSignups(reqAs(adminSession), true);

		assert.equal(users.usersSnapshot(undefined, OWNER).canSignUp, false);
		assert.equal(users.usersSnapshot(reqAs(memberSession), OWNER).canSignUp, false);
		assert.equal(users.usersSnapshot(reqAs(adminSession), OWNER).canSignUp, true);
		refusal(() => users.createProfile(undefined, { name: "Cy", color: "amber" }, OTHER), 403);
		refusal(() => users.createProfile(reqAs(memberSession), { name: "Cy", color: "amber" }, OTHER), 403);
		assert.throws(() => users.assertOwnAccount(OTHER, OWNER), (err: unknown) => err instanceof users.UsersError && err.status === 403);

		users.setRestrictedSignups(reqAs(adminSession), false);
		const self = users.createProfile(undefined, { name: "Cy", color: "amber" }, OTHER);
		assert.ok(self.sessionId, "self sign-up from the select screen signs in");
		assert.equal(self.profile.role, "member", "only the first profile is an admin");
	});

	it("deleting: admin only, never an admin profile, and the folder and sessions go with it", async () => {
		refusal(() => users.deleteProfile(reqAs(memberSession), adminId), 403);
		refusal(() => users.deleteProfile(reqAs(adminSession), adminId), 409);
		refusal(() => users.deleteProfile(reqAs(adminSession), "usr_missing"), 404);

		users.deleteProfile(reqAs(adminSession), memberId);
		assert.ok(!fs.existsSync(config.userDataDir(memberId)));
		assert.equal(users.sessionProfileId(memberSession), null);
		assert.equal((await whoAmI(reqAs(memberSession))).status, 401);
		assert.ok(fs.existsSync(path.join(config.userDataDir(adminId), "chats", "c1.json")), "other profiles untouched");
	});

	it("ending a session signs the browser out", async () => {
		const session = users.unlockProfile(adminId, undefined, OWNER);
		users.endSession(reqAs(session));
		assert.equal((await whoAmI(reqAs(session))).status, 401);
	});

	it("the event channel only carries the subscriber's profile's events (and profile-less ones)", async () => {
		const cy = users.usersSnapshot(undefined, OTHER).profiles.find((p) => p.name === "Cy");
		assert.equal(users.usersSnapshot(reqAs(adminSession), OWNER).profiles.some((p) => p.name === "Cy"), false);
		assert.ok(cy);
		const res = config.runAsUser(adminId, () => eventsResponse());
		const reader = res.body!.getReader();
		config.runAsUser(cy.id, () => emit("chats-changed", {}));
		config.runAsUser(adminId, () => emit("turn-started", { chatId: "mine" }));
		emit("subscriptions-changed", {});
		const decoder = new TextDecoder();
		let text = "";
		while (!text.includes("subscriptions-changed")) {
			const { value } = await reader.read();
			text += decoder.decode(value);
		}
		await reader.cancel();
		assert.ok(text.includes("turn-started"));
		assert.ok(!text.includes("chats-changed"), "another profile's event never reaches this window");
	});

	it("a profile created with a language starts in it; an unknown language is ignored", async () => {
		const { readSettings } = await import("../src/store/settings.ts");
		const es = users.createProfile(reqAs(adminSession), { name: "Dani", color: "sky", language: "es" }, OWNER).profile;
		assert.equal(config.runAsUser(es.id, () => readSettings())?.general?.language, "es");
		const other = users.createProfile(reqAs(adminSession), { name: "Eli", color: "sky", language: "xx" }, OWNER).profile;
		assert.equal(config.runAsUser(other.id, () => readSettings()), null, "no seed = no settings record");
	});

	it("editing a profile's language writes its settings; the snapshot reports each profile's language", async () => {
		const { readSettings } = await import("../src/store/settings.ts");
		const fran = users.createProfile(reqAs(adminSession), { name: "Fran", color: "teal" }, OWNER).profile;
		const franSession = users.unlockProfile(fran.id, undefined, OWNER);
		const snapshotLanguage = (id: string) => users.usersSnapshot(reqAs(adminSession), OWNER).profiles.find((p) => p.id === id)?.language;
		assert.equal(snapshotLanguage(fran.id), "en", "no record = the default language");
		assert.equal(users.updateProfile(reqAs(adminSession), fran.id, { language: "es" }).language, "es");
		assert.equal(config.runAsUser(fran.id, () => readSettings())?.general?.language, "es");
		assert.equal(snapshotLanguage(fran.id), "es");
		refusal(() => users.updateProfile(reqAs(adminSession), fran.id, { language: "xx" }), 400);
		assert.equal(users.updateProfile(reqAs(franSession), fran.id, { language: "en" }).language, "en");
		assert.equal(users.usersSnapshot(reqAs(franSession), OWNER).current?.language, "en");
	});
});
