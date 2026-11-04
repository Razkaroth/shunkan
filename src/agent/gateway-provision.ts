/**
 * Model calls are provisioned through the Vercel AI SDK and AI Gateway.
 * Per-provider API keys, the custom OpenAI-compatible endpoint, and
 * ChatGPT/Codex or other subscription logins are not the request credential.
 *
 * Stripe usage metering is the gateway's own integration: a restricted key
 * on the provider, and the active profile's Stripe customer id on the
 * request. The gateway emits Billing Meter events. This module does not
 * price, invoice, or record usage itself.
 */
import {
	APICallError,
	createGateway,
	jsonSchema,
	streamText,
	tool,
	type ModelMessage,
} from "ai";
import {
	calculateCost,
	type Api,
	type AssistantMessage,
	type Model,
	type SimpleStreamOptions,
	type JsonObject,
	type StopReason,
	type Tool as PiTool,
	type TranscriptContext,
	type Usage,
} from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { SpendBlockedError } from "../core/billing.ts";

const STRIPE_CUSTOMER = "stripe-customer-id";
const STRIPE_RESTRICTED_KEY = "stripe-restricted-access-key";

const PROVIDER_CREATOR: Record<string, string> = {
	chatgpt: "openai",
	"openai-codex": "openai",
	"xai-subscription": "xai",
	"google-vertex": "google",
	"claude-code": "anthropic",
};

/** Creators in the installed AI Gateway catalog. An unknown provider name is not a creator. */
const GATEWAY_CREATORS = new Set([
	"alibaba", "amazon", "anthropic", "arcee-ai", "bytedance", "callstack", "cohere", "deepseek",
	"fireworks", "google", "inception", "inclusionai", "interfaze", "liquid", "meituan", "meta",
	"minimax", "mistral", "mixedbread", "moonshotai", "nvidia", "openai", "poolside", "quiverai",
	"reflection", "sakana", "spacexai", "stealth", "stepfun", "tencent", "thinkingmachines",
	"xiaomi", "zai",
]);

let customerLookup: () => string | undefined = () => undefined;
let spendGuard: () => Promise<void> = async () => {};

/** Server boot installs the profile lookup. Tests can replace it. */
export function configureGatewayCustomer(lookup: () => string | undefined): void {
	customerLookup = lookup;
}

/** Server boot installs the credit decision. The default allows the call. */
export function configureSpendGuard(guard: () => Promise<void>): void {
	spendGuard = guard;
}

export function gatewayCustomerId(): string | undefined {
	try {
		const id = customerLookup()?.trim();
		return id && /^cus_[A-Za-z0-9]+$/.test(id) ? id : undefined;
	} catch {
		return undefined;
	}
}

/**
 * DeepSeek calls spend the owner's DeepSeek API credits when
 * `DEEPSEEK_API_KEY` is set: the key rides the gateway request as BYOK.
 * Other models, including the one GPT-Sol session, do not use that key.
 * With no key, the gateway keeps whatever DeepSeek credential it already
 * has cached. This does not set a price.
 */
export function deepseekByokOptions(
	modelId: string,
	env: NodeJS.ProcessEnv | { DEEPSEEK_API_KEY?: string } = process.env,
): { gateway: { byok: { deepseek: Array<{ apiKey: string }> } } } | undefined {
	if (!modelId.startsWith("deepseek/")) return undefined;
	const apiKey = env.DEEPSEEK_API_KEY?.trim();
	if (!apiKey) return undefined;
	return { gateway: { byok: { deepseek: [{ apiKey }] } } };
}

/** Providers that must not be sent to the gateway. */
export function gatewayRefusedProvider(provider: string): string | undefined {
	if (provider === "custom") return "Custom endpoints are not used for model calls. Select an AI Gateway model.";
	if (provider === "opencode" || provider === "opencode-go") return "OpenCode models are not on the AI Gateway. Select a gateway model.";
	return undefined;
}

/** Production calls authenticate at the gateway. The provider's own key is not that credential. */
export function gatewayAuthenticates(provider: string): boolean {
	return gatewayRefusedProvider(provider) === undefined;
}

/** Gateway model ids are `creator/model` strings from the live catalog. */
export function gatewayModelId(model: { provider: string; id: string; api?: string }): string {
	if (model.provider === "custom") {
		throw new Error("Custom endpoints are not used for model calls. Select an AI Gateway model.");
	}
	const refused = gatewayRefusedProvider(model.provider);
	if (refused) throw new Error(refused);
	if (model.provider === "vercel-ai-gateway" || model.id.includes("/")) return model.id;
	const creator = model.provider === "github-copilot" || model.provider === "github-copilot-subscription"
		? (model.api?.startsWith("anthropic") ? "anthropic" : model.api?.includes("google") ? "google" : "openai")
		: PROVIDER_CREATOR[model.provider] ?? model.provider;
	if (!GATEWAY_CREATORS.has(creator)) {
		throw new Error(`AI Gateway has no creator for ${model.provider}. Select an AI Gateway model.`);
	}
	return `${creator}/${model.id}`;
}

function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function emptyMessage(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		api: model.api,
		provider: model.provider,
		model: model.id,
		content: [],
		stopReason: "stop",
		timestamp: Date.now(),
		usage: emptyUsage(),
	};
}

function systemInstructions(context: TranscriptContext): string {
	const parts: string[] = [];
	const sections = new Map<string, string>();
	for (const message of context.messages) {
		if (message.role !== "system") continue;
		const text = typeof message.content === "string"
			? message.content
			: message.content.map((part) => part.text).join("");
		if (text) parts.push(text);
		for (const [name, value] of Object.entries(message.sections ?? {})) {
			if (value === null) sections.delete(name);
			else sections.set(name, value);
		}
	}
	return [...parts, ...sections.values()].filter(Boolean).join("\n\n");
}

function activeTools(context: TranscriptContext): PiTool[] {
	const tools = new Map<string, PiTool>();
	for (const message of context.messages) {
		if (message.role !== "system") continue;
		for (const added of message.toolsAdded ?? []) tools.set(added.name, added);
		for (const removed of message.toolsRemoved ?? []) tools.delete(removed.name);
	}
	return [...tools.values()];
}

function toMessages(context: TranscriptContext): ModelMessage[] {
	const messages: ModelMessage[] = [];
	for (const message of context.messages) {
		if (message.role === "system") continue;
		if (message.role === "user") {
			if (typeof message.content === "string") {
				messages.push({ role: "user", content: message.content });
				continue;
			}
			messages.push({
				role: "user",
				content: message.content.map((part) => part.type === "text"
					? { type: "text" as const, text: part.text }
					: { type: "file" as const, data: part.data, mediaType: part.mimeType }),
			});
			continue;
		}
		if (message.role === "assistant") {
			const content: Extract<ModelMessage, { role: "assistant" }>["content"] = [];
			for (const part of message.content) {
				if (part.type === "text" && part.text) content.push({ type: "text", text: part.text });
				else if (part.type === "thinking" && part.thinking) content.push({ type: "reasoning", text: part.thinking });
				else if (part.type === "toolCall") content.push({
					type: "tool-call",
					toolCallId: part.id,
					toolName: part.name,
					input: part.arguments,
				});
			}
			if (typeof content !== "string" && content.length > 0) messages.push({ role: "assistant", content });
			continue;
		}
		if (message.role !== "toolResult") continue;
		const text = message.content.map((part) => part.type === "text" ? part.text : "").join("");
		const images = message.content.flatMap((part) => part.type === "image"
			? [{ type: "file" as const, data: { type: "data" as const, data: part.data }, mediaType: part.mimeType }]
			: []);
		const output = message.isError
			? { type: "error-text" as const, value: text || "Tool failed" }
			: images.length === 0
				? { type: "text" as const, value: text }
				: {
					type: "content" as const,
					value: [
						...(text ? [{ type: "text" as const, text }] : []),
						...images,
					],
				};
		messages.push({
			role: "tool",
			content: [{
				type: "tool-result",
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				output,
			}],
		});
	}
	return messages;
}

function reasoningLevel(level: ThinkingLevel | undefined): "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined {
	if (level === undefined) return undefined;
	if (level === "off") return "none";
	return level;
}

function finishReason(reason: string, toolUse: boolean): Extract<StopReason, "stop" | "length" | "toolUse"> | "error" {
	if (toolUse || reason === "tool-calls") return "toolUse";
	if (reason === "length") return "length";
	if (reason === "stop") return "stop";
	return "error";
}

function usageFrom(model: Model<Api>, usage: {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
	outputTokenDetails?: { reasoningTokens?: number };
} | undefined): Usage {
	const input = usage?.inputTokens ?? 0;
	const output = usage?.outputTokens ?? 0;
	const cacheRead = usage?.inputTokenDetails?.cacheReadTokens ?? 0;
	const cacheWrite = usage?.inputTokenDetails?.cacheWriteTokens ?? 0;
	const reasoning = usage?.outputTokenDetails?.reasoningTokens;
	const pi: Usage = {
		input,
		output,
		cacheRead,
		cacheWrite,
		...(reasoning !== undefined ? { reasoning } : {}),
		totalTokens: usage?.totalTokens ?? input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	try { calculateCost(model, pi); } catch { /* catalog rates are display-only; Stripe meters the call */ }
	return pi;
}

function publicError(err: unknown, aborted: boolean): string {
	if (aborted) return "AI Gateway request cancelled.";
	if (err instanceof SpendBlockedError) return err.message;
	const cause = err instanceof Error ? err.cause : undefined;
	const api = APICallError.isInstance(err) ? err : APICallError.isInstance(cause) ? cause : undefined;
	if (api?.statusCode === 401) return "AI Gateway rejected the credential. Set AI_GATEWAY_API_KEY, or deploy on Vercel so OIDC can authenticate.";
	if (api?.statusCode === 402) return "AI Gateway has no credits for this request.";
	if (api?.statusCode === 429) return "AI Gateway rate limit reached. Retry after a short wait.";
	const message = err instanceof Error ? err.message : "";
	if (/api key|AI_GATEWAY_API_KEY|OIDC/i.test(message)) return "Set AI_GATEWAY_API_KEY to provision models through the Vercel AI Gateway.";
	// Upstream bodies stay off the transcript. They can carry account or request detail.
	return "AI Gateway request failed.";
}

function asArguments(input: unknown): { arguments: JsonObject; argumentsError?: string } {
	if (input && typeof input === "object" && !Array.isArray(input)) return { arguments: input as JsonObject };
	if (typeof input === "string") {
		try {
			const parsed = JSON.parse(input) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { arguments: parsed as JsonObject };
		} catch (err) {
			return { arguments: {}, argumentsError: err instanceof Error ? err.message : "Invalid tool arguments" };
		}
	}
	return { arguments: {}, argumentsError: "Tool arguments were not a JSON object." };
}

/** One Pi agent step, streamed through the AI SDK gateway. Tools are not executed here. */
export function gatewayStream(model: Model<Api>, context: TranscriptContext, options?: Omit<SimpleStreamOptions, "reasoning"> & { reasoning?: ThinkingLevel }): AssistantMessageEventStream {
	const output = new AssistantMessageEventStream();
	const partial = emptyMessage(model);
	void (async () => {
		let started = false;
		let terminal = false;
		const fail = (err: unknown) => {
			if (terminal) return;
			terminal = true;
			const aborted = options?.signal?.aborted === true;
			partial.stopReason = aborted ? "aborted" : "error";
			partial.errorMessage = publicError(err, aborted);
			output.push({ type: "error", reason: partial.stopReason, error: partial });
		};
		try {
			await spendGuard();
			const modelId = gatewayModelId(model);
			const providerOptions = deepseekByokOptions(modelId);
			const customerId = gatewayCustomerId();
			const restrictedKey = process.env.STRIPE_RESTRICTED_ACCESS_KEY?.trim();
			const headers: Record<string, string> = {};
			if (customerId) headers[STRIPE_CUSTOMER] = customerId;
			if (restrictedKey) headers[STRIPE_RESTRICTED_KEY] = restrictedKey;
			const gateway = createGateway({
				...(process.env.AI_GATEWAY_API_KEY ? { apiKey: process.env.AI_GATEWAY_API_KEY } : {}),
				...(Object.keys(headers).length > 0 ? { headers } : {}),
				...(options?.fetch ? { fetch: options.fetch } : {}),
			});
			const piTools = activeTools(context);
			const tools = piTools.length === 0 ? undefined : Object.fromEntries(piTools.map((item) => [item.name, tool({
				description: item.description,
				inputSchema: jsonSchema(item.parameters as never),
			})]));
			const messages = toMessages(context);
			const instructions = systemInstructions(context);
			const requested = reasoningLevel(options?.reasoning as ThinkingLevel | undefined);
			// Non-reasoning models have no effort setting. "none" is only for models that would otherwise reason.
			const reasoning = !model.reasoning && requested === "none" ? undefined : requested;
			const result = streamText({
				model: gateway(modelId),
				...(providerOptions ? { providerOptions } : {}),
				...(instructions ? { instructions } : {}),
				...(messages.length > 0 ? { messages } : { prompt: "" }),
				...(tools ? { tools } : {}),
				...(reasoning ? { reasoning } : {}),
				...(customerId ? { headers: { [STRIPE_CUSTOMER]: customerId } } : {}),
				abortSignal: options?.signal,
				maxRetries: 0,
				streamRetries: 0,
			});
			output.push({ type: "start", partial });
			started = true;
			const toolIndex = new Map<string, number>();
			let textIndex = -1;
			let thinkingIndex = -1;
			let sawTool = false;
			let reason = "stop";
			let reported: Parameters<typeof usageFrom>[1];
			for await (const part of result.stream) {
				if (part.type === "text-start" || (part.type === "text-delta" && textIndex < 0)) {
					textIndex = partial.content.length;
					partial.content.push({ type: "text", text: "" });
					output.push({ type: "text_start", contentIndex: textIndex, partial });
					if (part.type === "text-start") continue;
				}
				if (part.type === "text-delta") {
					const block = partial.content[textIndex];
					if (block?.type === "text") block.text += part.text;
					output.push({ type: "text_delta", contentIndex: textIndex, delta: part.text, partial });
					continue;
				}
				if (part.type === "text-end") {
					const block = partial.content[textIndex];
					output.push({ type: "text_end", contentIndex: textIndex, content: block?.type === "text" ? block.text : "", partial });
					continue;
				}
				if (part.type === "reasoning-start" || (part.type === "reasoning-delta" && thinkingIndex < 0)) {
					thinkingIndex = partial.content.length;
					partial.content.push({ type: "thinking", thinking: "" });
					output.push({ type: "thinking_start", contentIndex: thinkingIndex, partial });
					if (part.type === "reasoning-start") continue;
				}
				if (part.type === "reasoning-delta") {
					const block = partial.content[thinkingIndex];
					if (block?.type === "thinking") block.thinking += part.text;
					output.push({ type: "thinking_delta", contentIndex: thinkingIndex, delta: part.text, partial });
					continue;
				}
				if (part.type === "reasoning-end") {
					const block = partial.content[thinkingIndex];
					output.push({ type: "thinking_end", contentIndex: thinkingIndex, content: block?.type === "thinking" ? block.thinking : "", partial });
					continue;
				}
				if (part.type === "tool-input-start") {
					const index = partial.content.length;
					toolIndex.set(part.id, index);
					partial.content.push({ type: "toolCall", id: part.id, name: part.toolName, arguments: {} });
					output.push({ type: "toolcall_start", contentIndex: index, partial });
					continue;
				}
				if (part.type === "tool-input-delta") {
					const index = toolIndex.get(part.id);
					if (index === undefined) continue;
					output.push({ type: "toolcall_delta", contentIndex: index, delta: part.delta, partial });
					continue;
				}
				if (part.type === "tool-call") {
					sawTool = true;
					let index = toolIndex.get(part.toolCallId);
					if (index === undefined) {
						index = partial.content.length;
						toolIndex.set(part.toolCallId, index);
						partial.content.push({ type: "toolCall", id: part.toolCallId, name: part.toolName, arguments: {} });
						output.push({ type: "toolcall_start", contentIndex: index, partial });
					}
					const parsed = asArguments(part.input);
					const toolCall = {
						type: "toolCall" as const,
						id: part.toolCallId,
						name: part.toolName,
						arguments: parsed.arguments,
						...(parsed.argumentsError ? { argumentsError: parsed.argumentsError } : {}),
					};
					partial.content[index] = toolCall;
					output.push({ type: "toolcall_end", contentIndex: index, toolCall, partial });
					continue;
				}
				if (part.type === "finish-step" || part.type === "finish") {
					reason = part.finishReason;
					reported = part.type === "finish" ? part.totalUsage : part.usage;
				}
				if (part.type === "error") fail(part.error);
				if (part.type === "abort") fail(new Error("aborted"));
			}
			if (terminal) return;
			partial.usage = usageFrom(model, reported);
			const mapped = finishReason(reason, sawTool);
			if (mapped === "error") {
				fail(new Error("AI Gateway request failed."));
				return;
			}
			partial.stopReason = mapped;
			terminal = true;
			output.push({ type: "done", reason: mapped, message: partial });
		} catch (err) {
			if (!started && !terminal) {
				fail(err);
				return;
			}
			fail(err);
		} finally {
			output.end();
		}
	})();
	return output;
}
