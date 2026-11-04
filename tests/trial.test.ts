/**
 * University trial: one invite, DeepSeek on all three tiers, one GPT-Sol
 * session, then a signup before anything else runs. No price is stored.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "lh-trial-"));
process.env.LH_DATA_DIR = ROOT;
process.env.TRIAL_INVITE_CODE = "friend-code";
delete process.env.DEEPSEEK_API_KEY;

const config = await import("../config.ts");
const trial = await import("../src/server/trial.ts");
const users = await import("../src/server/users.ts");
const { readSettings, writeSettings } = await import("../src/store/settings.ts");
const { mintUserId, writeProfiles } = await import("../src/store/users.ts");
const { TRIAL_DEEPSEEK_MODEL, TRIAL_SOL_MODEL } = await import("../src/core/trial.ts");
const { deepseekByokOptions } = await import("../src/agent/gateway-provision.ts");

after(() => {
	trial.resetTrialAccountCreator();
	fs.rmSync(ROOT, { recursive: true, force: true });
});

function req(sessionId: string | null): Request {
	return new Request("http://localhost/api/trial", {
		headers: sessionId ? { cookie: `${users.SESSION_COOKIE}=${encodeURIComponent(sessionId)}` } : {},
	});
}

function refusal(fn: () => unknown, status: number) {
	assert.throws(fn, (err: unknown) => err instanceof trial.TrialError && err.status === status);
}

describe("university trial", () => {
	it("uses the gateway catalog ids and does not name a price", () => {
		const catalog = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../node_modules/@earendil-works/pi-ai/dist/providers/data/vercel-ai-gateway.json", import.meta.url)), "utf8")) as {
			"anthropic-messages": Record<string, { id?: string; name?: string }>;
		};
		const deepseek = catalog["anthropic-messages"][`chat:${TRIAL_DEEPSEEK_MODEL.id}`];
		const sol = catalog["anthropic-messages"][`chat:${TRIAL_SOL_MODEL.id}`];
		assert.equal(deepseek?.id, "deepseek/deepseek-v4.1-flash");
		assert.equal(deepseek?.name, "DeepSeek V4.1 Flash");
		assert.equal(sol?.id, "openai/gpt-6.1-sol");
		assert.equal(sol?.name, "GPT-6.1 Sol");
		assert.equal(TRIAL_DEEPSEEK_MODEL.provider, "vercel-ai-gateway");
		assert.equal(TRIAL_SOL_MODEL.provider, "vercel-ai-gateway");
		assert.equal("cost" in TRIAL_SOL_MODEL, false);
		assert.equal("cost" in TRIAL_DEEPSEEK_MODEL, false);
		const options = fs.readFileSync(fileURLToPath(new URL("../lib/auth/options.ts", import.meta.url)), "utf8");
		assert.match(options, /disableSignUp:\s*true/);
	});

	it("sends the owner's DeepSeek key only for DeepSeek gateway calls", () => {
		assert.equal(deepseekByokOptions(TRIAL_SOL_MODEL.id, { DEEPSEEK_API_KEY: "sk-deepseek-owner" }), undefined);
		assert.equal(deepseekByokOptions(TRIAL_DEEPSEEK_MODEL.id, {}), undefined);
		assert.deepEqual(deepseekByokOptions(TRIAL_DEEPSEEK_MODEL.id, { DEEPSEEK_API_KEY: " sk-deepseek-owner " }), {
			gateway: { byok: { deepseek: [{ apiKey: "sk-deepseek-owner" }] } },
		});
	});

	it("refuses to redeem over unclaimed learner records, then redeems once as a member", () => {
		fs.mkdirSync(path.join(ROOT, "chats"), { recursive: true });
		fs.writeFileSync(path.join(ROOT, "chats", "keep.json"), "{}");
		refusal(() => trial.redeemTrialCode(undefined, { code: "friend-code", name: "Friend", color: "teal" }), 409);
		fs.rmSync(path.join(ROOT, "chats"), { recursive: true });
		refusal(() => trial.redeemTrialCode(undefined, { code: "friend-code", name: "Friend", color: "teal" }), 409);
		writeProfiles([{ id: mintUserId(), name: "Owner", color: "sky", role: "admin", createdAt: "2026-11-03T00:00:00.000Z" }]);

		refusal(() => trial.redeemTrialCode(undefined, { code: "nope", name: "Friend", color: "teal" }), 403);
		const { profileId, sessionId } = trial.redeemTrialCode(undefined, { code: "friend-code", name: "  Ada  ", color: "teal" });
		assert.ok(sessionId);
		const profile = users.usersSnapshot(req(sessionId)).current;
		assert.equal(profile?.id, profileId);
		assert.equal(profile?.role, "member");
		assert.equal(profile?.trial, true);
		assert.equal(profile?.name, "Ada");
		refusal(() => trial.redeemTrialCode(undefined, { code: "friend-code", name: "Eve", color: "sky" }), 409);
		fs.rmSync(config.INSTALL.trial);
		refusal(() => trial.redeemTrialCode(undefined, { code: "friend-code", name: "Eve", color: "sky" }), 409);
		fs.writeFileSync(config.INSTALL.trial, `${JSON.stringify({ version: 1, profileId, redeemedAt: "2026-11-03T00:00:00.000Z" })}\n`);
		assert.equal(trial.trialStatusFor(null).open, false);
		const stored = fs.readFileSync(config.INSTALL.trial, "utf8");
		assert.doesNotMatch(stored, /friend-code/);

		const slots = config.runAsUser(profileId, () => readSettings()?.models);
		for (const tier of ["strong", "cheap", "vision"] as const) {
			assert.equal(slots?.[tier]?.model?.id, TRIAL_DEEPSEEK_MODEL.id);
			assert.equal(slots?.[tier]?.model?.provider, TRIAL_DEEPSEEK_MODEL.provider);
		}
		config.runAsUser(profileId, () => {
			writeSettings({
				version: 1,
				models: { strong: { model: { provider: "openai", id: "gpt-4o" } } },
				agent: { models: { researcher: { model: { provider: "openai", id: "gpt-4o" } } } },
			});
			const pinned = readSettings();
			assert.equal(pinned?.models?.strong?.model?.id, TRIAL_DEEPSEEK_MODEL.id);
			assert.equal(pinned?.models?.cheap?.model?.id, TRIAL_DEEPSEEK_MODEL.id);
			assert.equal(pinned?.models?.vision?.model?.id, TRIAL_DEEPSEEK_MODEL.id);
			assert.equal(pinned?.agent?.models, undefined);
		});
	});

	it("includes one GPT-Sol session, then requires the trial signup before continuing", async () => {
		const friend = users.usersSnapshot(undefined).profiles.find((p) => p.trial);
		assert.ok(friend);
		const sessions = JSON.parse(fs.readFileSync(config.INSTALL.sessions, "utf8")) as Record<string, { userId: string }>;
		const cookie = Object.entries(sessions).find(([, entry]) => entry.userId === friend.id)?.[0];
		assert.ok(cookie);
		const authed = req(cookie);

		const started = trial.startSolSession(authed);
		assert.equal(trial.startSolSession(authed).chatId, started.chatId);
		const chat = config.runAsUser(friend.id, () => {
			return JSON.parse(fs.readFileSync(path.join(config.userDataDir(friend.id), "chats", `${started.chatId}.json`), "utf8")) as {
				settings?: { model?: { id?: string } };
			};
		});
		assert.equal(chat.settings?.model?.id, TRIAL_SOL_MODEL.id);
		assert.equal(config.runAsUser(friend.id, () => trial.trialMainModel(started.chatId)?.id), TRIAL_SOL_MODEL.id);
		assert.equal(config.runAsUser(friend.id, () => trial.trialMainModel("chat_other")?.id), TRIAL_DEEPSEEK_MODEL.id);

		await assert.rejects(
			() => trial.signUpFromTrial(authed, { email: "ada@example.edu", name: "Ada", password: "long-enough" }),
			(err: unknown) => err instanceof trial.TrialError && err.status === 409,
		);

		trial.noteSolSessionEnded(friend.id, started.chatId);
		const blocked = config.runAsUser(friend.id, () => trial.trialBlockResponse());
		assert.equal(blocked?.status, 403);
		const body = (await blocked!.json()) as { code?: string };
		assert.equal(body.code, "trial_signup_required");
		refusal(() => trial.startSolSession(authed), 403);

		let createdEmail = "";
		trial.configureTrialAccountCreator(async (input) => {
			createdEmail = input.email;
			return { id: "user_trial_ada" };
		});
		const account = await trial.signUpFromTrial(authed, { email: "ada@example.edu", name: "Ada", password: "long-enough" });
		assert.equal(account.accountId, "user_trial_ada");
		assert.equal(createdEmail, "ada@example.edu");
		assert.equal(config.runAsUser(friend.id, () => trial.trialBlockResponse()), null);
		assert.equal(trial.trialStatusFor(friend.id).signedUp, true);
		refusal(() => trial.startSolSession(authed), 409);
		assert.doesNotMatch(fs.readFileSync(config.INSTALL.trial, "utf8"), /long-enough/);
	});
});
