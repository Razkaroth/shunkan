import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { getSupportedThinkingLevels, normalizeContext } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-gateway-"));
process.env.LH_DATA_DIR = root;

const { runAsUser, activeUserId } = await import("../config.ts");
const { configureGatewayCustomer, gatewayCustomerId, gatewayModelId } = await import("../src/agent/gateway-provision.ts");
const { piEngineForSpec, piModels } = await import("../src/agent/models.ts");
const { isStripeCustomerId } = await import("../src/core/users.ts");
await import("../src/server/gateway-customer.ts");
const { SESSION_COOKIE, updateProfile, UsersError } = await import("../src/server/users.ts");
const { createSession, readProfiles, writeProfiles } = await import("../src/store/users.ts");

const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;
const previousStripeKey = process.env.STRIPE_RESTRICTED_ACCESS_KEY;
const previousFetch = globalThis.fetch;

after(() => {
	if (previousGatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
	else process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
	if (previousStripeKey === undefined) delete process.env.STRIPE_RESTRICTED_ACCESS_KEY;
	else process.env.STRIPE_RESTRICTED_ACCESS_KEY = previousStripeKey;
	globalThis.fetch = previousFetch;
	fs.rmSync(root, { recursive: true, force: true });
});

function restoreProfileLookup(): void {
	configureGatewayCustomer(() => {
		const id = activeUserId();
		if (!id) return undefined;
		return readProfiles().find((profile) => profile.id === id)?.stripeCustomerId;
	});
}

describe("AI Gateway provisioning", { concurrency: false }, () => {
	test("model ids use creator/model and do not keep a custom endpoint", () => {
		assert.equal(gatewayModelId({ provider: "vercel-ai-gateway", id: "anthropic/claude-sonnet-5" }), "anthropic/claude-sonnet-5");
		assert.equal(gatewayModelId({ provider: "openai-codex", id: "gpt-5.6-luna" }), "openai/gpt-5.6-luna");
		assert.equal(gatewayModelId({ provider: "chatgpt", id: "gpt-5.6-luna" }), "openai/gpt-5.6-luna");
		assert.equal(gatewayModelId({ provider: "github-copilot-subscription", id: "claude-sonnet-5", api: "anthropic-messages" }), "anthropic/claude-sonnet-5");
		assert.equal(gatewayModelId({ provider: "openrouter", id: "openai/gpt-4o-mini" }), "openai/gpt-4o-mini");
		assert.throws(() => gatewayModelId({ provider: "custom", id: "local-llama" }), /Custom endpoints are not used/);
		assert.throws(() => gatewayModelId({ provider: "custom", id: "openai/gpt-4o-mini" }), /Custom endpoints are not used/);
		assert.throws(() => gatewayModelId({ provider: "custom", id: "local/llama" }), /Custom endpoints are not used/);
		assert.throws(() => gatewayModelId({ provider: "opencode-go", id: "glm-5.3" }), /not on the AI Gateway/);
		assert.throws(() => gatewayModelId({ provider: "opencode-go", id: "gpt-6-luna" }), /not on the AI Gateway/);
		assert.throws(() => gatewayModelId({ provider: "not-a-creator", id: "some-model" }), /no creator/);
	});

	test("the engine streams through AI Gateway and sends Stripe meter headers for the active profile", async () => {
		process.env.AI_GATEWAY_API_KEY = "gateway-test-key";
		process.env.STRIPE_RESTRICTED_ACCESS_KEY = "rk_test_meter_write";
		restoreProfileLookup();
		const model = piModels().getModels("openai")[0]!;
		const profileId = "usr_gatewaybill";
		writeProfiles([{
			id: profileId,
			name: "Gateway",
			color: "teal",
			role: "admin",
			stripeCustomerId: "cus_profile123",
			createdAt: "2026-11-03T00:00:00.000Z",
		}]);
		let url = "";
		let headers = new Headers();
		let body = "";
		globalThis.fetch = async (input, init) => {
			const request = new Request(input, init);
			url = request.url;
			headers = request.headers;
			body = await request.text();
			return new Response(JSON.stringify({ error: { message: "fixture refusal" } }), {
				status: 401,
				headers: { "content-type": "application/json" },
			});
		};
		const engine = piEngineForSpec({ provider: model.provider, id: model.id, thinkingLevel: "off" });
		const result = await runAsUser(profileId, () => engine.streamFn(engine.model, normalizeContext({
			messages: [{ role: "user", content: "offline", timestamp: 1 }],
			tools: [{ name: "offline_tool", description: "offline", parameters: Type.Object({}) }],
		}), {
			headers: { authorization: "Bearer sk-must-not-be-sent" },
		}).result());
		assert.equal(result.stopReason, "error");
		assert.match(result.errorMessage ?? "", /AI Gateway/);
		assert.equal(new URL(url).hostname, "ai-gateway.vercel.sh");
		assert.equal(headers.get("authorization"), "Bearer gateway-test-key");
		assert.equal(headers.get("stripe-customer-id"), "cus_profile123");
		assert.equal(headers.get("stripe-restricted-access-key"), "rk_test_meter_write");
		assert.equal(headers.get("authorization")?.includes("sk-must-not-be-sent"), false);
		assert.equal(headers.get("ai-language-model-id"), gatewayModelId(model));
		assert.equal(body.includes("sk-must-not-be-sent"), false);
		if (model.reasoning) assert.match(body, /"reasoning":"none"/);
		else assert.equal(body.includes('"reasoning"'), false);
	});

	test("an off reasoning level is sent as none, and image tool results stay in the request", async () => {
		process.env.AI_GATEWAY_API_KEY = "gateway-test-key";
		// Some reasoning models cannot represent "off" (the catalog clamps it to the nearest effort). This checks a model that can.
		const reasoning = ["anthropic", "openai", "google"].flatMap((id) => piModels().getModels(id)).find((model) => model.reasoning && getSupportedThinkingLevels(model).includes("off"));
		assert.ok(reasoning);
		let bodies: string[] = [];
		globalThis.fetch = async (input, init) => {
			const request = new Request(input, init);
			bodies.push(await request.text());
			return new Response(JSON.stringify({ error: { message: "fixture" } }), { status: 401, headers: { "content-type": "application/json" } });
		};
		const engine = piEngineForSpec({ provider: reasoning.provider, id: reasoning.id, thinkingLevel: "off" });
		await engine.streamFn(engine.model, normalizeContext({ messages: [{ role: "user", content: "offline", timestamp: 1 }] }), {}).result();
		assert.match(bodies[0] ?? "", /"reasoning":"none"/);
		const image = { type: "image" as const, data: "aaaa", mimeType: "image/png" };
		await engine.streamFn(engine.model, normalizeContext({
			messages: [
				{ role: "user", content: "look", timestamp: 1 },
				{ role: "assistant", content: [{ type: "toolCall", id: "read-1", name: "read", arguments: {} }], timestamp: 2, stopReason: "toolUse", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, api: engine.model.api, provider: engine.model.provider, model: engine.model.id },
				{ role: "toolResult", toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: "Read image file" }, image], isError: false, timestamp: 3 },
			],
		}), {}).result();
		assert.match(bodies[1] ?? "", /image\/png/);
		assert.match(bodies[1] ?? "", /aaaa/);
		assert.equal((bodies[1] ?? "").includes("Read image file"), true);
	});

	test("only an admin can store a Stripe customer id, and the public profile omits it", () => {
		assert.equal(isStripeCustomerId("cus_abc"), true);
		assert.equal(isStripeCustomerId("sk_live_secret"), false);
		configureGatewayCustomer(() => "not-a-customer");
		assert.equal(gatewayCustomerId(), undefined);
		restoreProfileLookup();
		const admin = "usr_gatewayadmin";
		const member = "usr_gatewaymember";
		writeProfiles([
			{ id: admin, name: "Admin", color: "sky", role: "admin", createdAt: "2026-11-03T00:00:00.000Z" },
			{ id: member, name: "Member", color: "lime", role: "member", createdAt: "2026-11-03T00:00:00.000Z" },
		]);
		const adminReq = new Request("http://localhost/api/users/" + member, { headers: { cookie: `${SESSION_COOKIE}=${createSession(admin)}` } });
		const memberReq = new Request("http://localhost/api/users/" + member, { headers: { cookie: `${SESSION_COOKIE}=${createSession(member)}` } });
		assert.throws(() => updateProfile(memberReq, member, { stripeCustomerId: "cus_member" }), (err: unknown) => err instanceof UsersError && err.status === 403);
		const updated = updateProfile(adminReq, member, { stripeCustomerId: "cus_member123" });
		assert.equal(Object.hasOwn(updated, "stripeCustomerId"), false);
		assert.equal(readProfiles().find((profile) => profile.id === member)?.stripeCustomerId, "cus_member123");
		updateProfile(adminReq, member, { stripeCustomerId: null });
		assert.equal(readProfiles().find((profile) => profile.id === member)?.stripeCustomerId, undefined);
		assert.throws(() => updateProfile(adminReq, member, { stripeCustomerId: "not-a-customer" }), (err: unknown) => err instanceof UsersError && err.status === 400);
	});
});
