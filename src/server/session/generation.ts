import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { FatalError, RetryableError } from "workflow";
import {
	createPracticeAgent,
	createProberAgent,
	createTeacherAgent,
	type AgentBuildOptions,
	type TeachingAgent,
} from "../../agent/teacher-agent.ts";
import { piEngineForSpec, type PiEngine } from "../../agent/models.ts";
import { connectionScopeCurrent, isSubscriptionProvider } from "../../agent/subscription-connections.ts";
import { chatGPTStreamError } from "../../agent/chatgpt-stream.ts";
import { nativeSubscriptionError } from "../../agent/subscription-stream.ts";
import { SubscriptionRequestCycle, type SubscriptionDispatchLifecycle } from "../../agent/subscription-request-cycle.ts";
import { gatewayAuthenticates, gatewayRefusedProvider } from "../../agent/gateway-provision.ts";
import { jobRunner } from "../chat-handler.ts";
import { noteSteersDurable } from "../jobs.ts";
import { providerKeyPresent } from "../keys.ts";
import { searchAvailable } from "../search.ts";
import { effectiveSettings, stores } from "../stores.ts";
import { ensureCompacted } from "../compaction.ts";
import { compactionDeps } from "./compaction-deps.ts";
import { persistTurn, TurnPersistenceError } from "../turn-service.ts";
import { rememberTurnFailure } from "../turn-runs.ts";
import { noteSolSessionEnded, trialMainModel } from "../trial.ts";
import { activeUserId } from "../../../config.ts";
import { CLAUDE_CODE_PROVIDER } from "../../core/contracts/claude-code.ts";
import { modelsNotConfigured, providerKeyMissing as providerKeyMissingEnvelope } from "../../core/settings.ts";
import { graphToolsEnabled, resolveConversationSpec } from "../../core/settings-resolution.ts";
import { asAgentMessages, hasProbeDone, hasUnresolvedQuestion, endsInDismissal, endsInQuestionRecovery, type LhMessage } from "../../core/native-messages.ts";
import { buildAbortSteer, buildSubagentSteer, steerDelivered, type CallUsage } from "../../core/contracts.ts";
import { collectToolCallIds, ToolCallIdUniquifier } from "../pi/call-ids.ts";
import { providerEventNote } from "../../agent/provider-events.ts";

export type GenerationWriter = {
	write(chunk: Uint8Array): Promise<void>;
};

const encoder = new TextEncoder();

function frame(event: unknown): Uint8Array {
	return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function roleOf(message: { role?: string } | undefined): string | undefined {
	return message?.role;
}

/** Pending job deliveries and parked user steers that are not already in the record. */
function foldedMessages(chatId: string, messages: readonly LhMessage[]): LhMessage[] {
	const extra: LhMessage[] = [];
	const seen = new Set(messages.map((message) => message.id));
	for (const message of stores.chatStore.getChat(chatId)?.pendingSteers ?? []) {
		if (seen.has(message.id)) continue;
		seen.add(message.id);
		extra.push(message);
	}
	for (const job of stores.jobStore.listJobs(chatId)) {
		if (job.delivery?.status !== "pending") continue;
		const steer = job.delivery.kind === "abort"
			? buildAbortSteer(job)
			: job.result ? buildSubagentSteer(job, job.result as never) : undefined;
		if (!steer || steerDelivered([...messages], steer.id) || seen.has(steer.id)) continue;
		seen.add(steer.id);
		extra.push(steer);
	}
	return extra;
}

/**
 * One provider generation. The caller is a step and owns the writable.
 * Returns continue when the generation ended on tool use and the question stopper did not end the turn.
 */
export async function runOneGeneration(chatId: string, writer: GenerationWriter): Promise<{ continue: boolean }> {
	console.log(`[turn ${chatId}] generation`);
	const record = stores.chatStore.getChat(chatId);
	if (!record) return { continue: false };
	if (hasUnresolvedQuestion(record.messages) || endsInDismissal(record.messages) || endsInQuestionRecovery(record.messages)) {
		return { continue: false };
	}

	const folded = foldedMessages(chatId, record.messages);
	const merged = [...record.messages, ...folded];
	if (folded.length > 0) {
		stores.chatStore.saveMessages(chatId, merged);
		const stillPending = (record.pendingSteers ?? []).filter((message) => !merged.some((saved) => saved.id === message.id));
		stores.chatStore.patchChat(chatId, { pendingSteers: stillPending.length > 0 ? stillPending : null });
		try { noteSteersDurable(chatId, merged); } catch (error) {
			console.error(`[chat ${chatId}] steer bookkeeping failed`, error);
		}
	}
	const tail = merged[merged.length - 1];
	if (!tail || roleOf(tail) === "assistant" || roleOf(tail) === "system") return { continue: false };

	const effective = effectiveSettings();
	let conversation = resolveConversationSpec(stores.chatStore.getChat(chatId)?.settings, effective.models.strong);
	const forced = trialMainModel(chatId);
	if (forced) conversation = { provider: forced.provider, id: forced.id, thinkingLevel: conversation?.thinkingLevel };
	if (!conversation) {
		const text = modelsNotConfigured(["strong"]).error;
		rememberTurnFailure(chatId, text);
		await writer.write(frame({ type: "error", errorText: text }));
		return { continue: false };
	}
	if (gatewayRefusedProvider(conversation.provider) || (!gatewayAuthenticates(conversation.provider) && !providerKeyPresent(conversation.provider))) {
		const missing = providerKeyMissingEnvelope(conversation.provider, ["strong"]);
		rememberTurnFailure(chatId, missing.error);
		await writer.write(frame({ type: "error", errorText: missing.error }));
		return { continue: false };
	}

	const deps = compactionDeps(chatId);
	if (deps) await ensureCompacted(deps, chatId);
	const fresh = stores.chatStore.getChat(chatId);
	if (!fresh) return { continue: false };
	const history = fresh.messages;
	const agentMessages = asAgentMessages(history);
	const baseCount = agentMessages.length;
	const background = roleOf(history[history.length - 1]) === "custom";
	const callPurpose = { background };

	let requestCycle: SubscriptionRequestCycle | undefined;
	const lifecycle: SubscriptionDispatchLifecycle = {
		captured: (scope) => requestCycle?.captured(scope),
		beforeDispatch: (scope) => requestCycle?.beforeDispatch(scope),
		noDispatch: (kind) => requestCycle?.noDispatch(kind),
	};
	let engine: PiEngine;
	try {
		engine = piEngineForSpec(conversation, () => callPurpose.background, lifecycle, () => stores.settingsStore.readSettings()?.models?.strong?.cacheRetention);
	} catch {
		const text = conversation.provider === "chatgpt"
			? chatGPTStreamError("model catalog")
			: isSubscriptionProvider(conversation.provider)
				? nativeSubscriptionError(conversation.provider, "model catalog")
				: "The selected model is unavailable.";
		rememberTurnFailure(chatId, text);
		await writer.write(frame({ type: "error", errorText: text }));
		return { continue: false };
	}

	const steps: CallUsage[] = [];
	const collectUsage = (usage: Usage) => {
		steps.push({
			inputTokens: usage.input,
			outputTokens: usage.output,
			cacheReadTokens: usage.cacheRead,
			cacheWriteTokens: usage.cacheWrite,
			cacheWrite1hTokens: usage.cacheWrite1h ?? 0,
			reasoningTokens: usage.reasoning ?? 0,
		});
	};
	if (isSubscriptionProvider(conversation.provider)) {
		requestCycle = new SubscriptionRequestCycle({
			initialMessages: agentMessages,
			foregroundOwed: !callPurpose.background,
			purpose: callPurpose,
			scopeCurrent: (scope) => connectionScopeCurrent(conversation.provider, scope),
			commitStaged: () => undefined,
			restoreAutomatic: () => undefined,
		});
	}
	const spawn = (job: { id: string; kind: string }, input: unknown) => {
		if (job.kind === "demo") return;
		if (job.kind === "visual") {
			void jobRunner.runJob(job.id, input as never);
			return;
		}
		void import("./wake.ts").then(({ startJobWorkflow }) => startJobWorkflow(job.id)).catch((error) => {
			console.error(`[job ${job.id}] workflow start failed`, error);
		});
	};
	const agentOpts: AgentBuildOptions = {
		engine,
		callPurpose,
		requestCycle,
		messages: agentMessages,
		onUsage: collectUsage,
		toolToggles: effective.agent.tools,
		chatId,
		promptSwitches: effective.agent.prompts,
		language: effective.general.language,
	};
	const teaching = hasProbeDone(agentMessages as unknown as LhMessage[]);
	const graph = graphToolsEnabled(effective) ? { graphStore: stores.graphStore } : {};
	const agent: TeachingAgent = fresh.kind === "practice"
		? createPracticeAgent({
			chatId,
			chatStore: stores.chatStore,
			graphNodes: () => stores.graphStore.readNodes(),
			jobs: { chatId, jobStore: stores.jobStore, spawn, searchAvailable },
			...(graphToolsEnabled(effective) ? { graph: { chatStore: stores.chatStore, graphStore: stores.graphStore } } : {}),
		}, agentOpts)
		: teaching
			? createTeacherAgent({
				chatId,
				chatStore: stores.chatStore,
				jobStore: stores.jobStore,
				spawn,
				searchAvailable,
			}, agentOpts)
			: createProberAgent({
				chatId,
				chatStore: stores.chatStore,
				deliver: (steer) => { void import("../jobs.ts").then(({ deliverJobResult }) => deliverJobResult(steer)); },
				jobStore: stores.jobStore,
				spawn,
				searchAvailable,
				...graph,
			}, agentOpts);

	let another = false;
	const original = agent.finishTurn?.bind(agent);
	agent.finishTurn = async (turn, signal) => {
		const decision = await original?.(turn, signal);
		if (decision?.action === "end") return decision;
		if (turn.message.stopReason === "toolUse") another = true;
		return { action: "end" };
	};

	const pending: unknown[] = [];
	let updateAt = -1;
	const push = (event: unknown, coalesce: boolean) => {
		if (coalesce) {
			if (updateAt >= 0) pending[updateAt] = event;
			else { updateAt = pending.length; pending.push(event); }
			return;
		}
		updateAt = -1;
		pending.push(event);
	};
	for (const message of folded) {
		push({ type: "message_start", message }, false);
		push({ type: "message_end", message }, false);
	}
	const uniquifier = new ToolCallIdUniquifier(collectToolCallIds(history));
	const unsubscribe = agent.subscribe((event) => {
		const uniqued = uniquifier.event(event as AgentEvent);
		const wire = uniqued.type === "message_update"
			? { type: "message_update", message: uniqued.message }
			: uniqued;
		push(wire, uniqued.type === "message_update");
	});
	providerEventNote(chatId, "turn", `run start (base: ${baseCount} messages)`);
	const learnerId = activeUserId();
	const modelId = `${engine.model.provider}:${engine.model.id}`;
	const turnUsageId = crypto.randomUUID();
	let persistedAssistant = false;
	try {
		if (requestCycle && !(await requestCycle.admission)) {
			rememberTurnFailure(chatId, "Background use is off for this connection.");
			await writer.write(frame({ type: "error", errorText: "Background use is off for this connection." }));
			return { continue: false };
		}
		await agent.continue();
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		console.error(`[chat ${chatId}] generation failed`, error);
		throw new RetryableError(text);
	} finally {
		unsubscribe();
	}

	const settled = uniquifier.remapSettled(
		[...agent.state.messages].filter((message) => roleOf(message as { role?: string }) !== "system"),
	) as AgentMessage[];
	let stamped: LhMessage[];
	try {
		stamped = persistTurn(stores.chatStore, chatId, baseCount, settled, false);
		persistedAssistant = stamped.some((message) => roleOf(message) === "assistant");
	} catch (error) {
		const text = error instanceof TurnPersistenceError ? error.message : "The reply could not be saved.";
		rememberTurnFailure(chatId, text);
		await writer.write(frame({ type: "error", errorText: text }));
		throw new FatalError(text);
	}
	try { noteSteersDurable(chatId, stores.chatStore.getChat(chatId)?.messages ?? stamped); } catch (error) {
		console.error(`[chat ${chatId}] steer bookkeeping failed`, error);
	}
	const response = stamped.find((message) => roleOf(message) === "assistant") as { id?: string; stopReason?: string } | undefined;
	const aborted = response?.stopReason === "aborted";
	if (!aborted && response) noteSolSessionEnded(learnerId, chatId);
	if (response?.id && steps.length > 0) {
		stores.chatStore.appendTurnUsage(chatId, {
			id: turnUsageId,
			messageId: response.id,
			at: new Date().toISOString(),
			model: modelId,
			steps,
		});
	}
	for (const event of pending) await writer.write(frame(event));
	const failed = response?.stopReason === "error" || aborted;
	if (failed && persistedAssistant) {
		if (response?.stopReason === "error") {
			rememberTurnFailure(chatId, "An error occurred.");
			await writer.write(frame({ type: "error", errorText: "An error occurred." }));
		}
		throw new FatalError("generation ended in error");
	}
	return { continue: another && !failed };
}
