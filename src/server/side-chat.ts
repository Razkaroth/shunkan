/**
 * Side chats are workflow children. The transcript on the chat record is the
 * history. The child run id is the liveness. Completing an answer wakes the
 * session, which folds the exchange into the teacher transcript without
 * starting a teacher turn unless one was already owed.
 */

import type { PiEngine } from "../agent/models.ts";
import { piEngineForSpec } from "../agent/models.ts";
import { composeSideChatInstructions, sideChatLanguage, streamSideAnswer, type SideAnswerResult } from "../agent/side-chat.ts";
import { COMPACTION_RESERVE_TOKENS } from "../core/compaction.ts";
import { collectCitations } from "../core/citations.ts";
import type { ChatRecord, SideChatMessage, SideChatThread } from "../core/contracts.ts";
import {
	failedOutputCallIds,
	newMessageId,
	userFacingTextOf,
} from "../core/native-messages.ts";
import {
	newSideQuestion,
	newSideThread,
	parseSideAskInput,
	parseSideOpenInput,
	sideChatLessonDocument,
	sideChatModelTurns,
	sideSegmentId,
	sideThreadAwaitsAnswer,
	SideChatInputError,
	type SideAskInput,
} from "../core/side-chat.ts";
import { resolveConversationSpec } from "../core/settings-resolution.ts";
import { activeUserId } from "../../config.ts";
import { effectiveSettings, stores } from "./stores.ts";
import { publishSideEntries } from "./side-publish.ts";

type SideRunner = (opts: {
	engine: PiEngine;
	instructions: string;
	turns: ReturnType<typeof sideChatModelTurns>;
	signal?: AbortSignal;
	onText?: (text: string) => void;
	chatId?: string;
	runId?: string;
}) => Promise<SideAnswerResult>;

let engineOverride: ((record: ChatRecord) => PiEngine) | null = null;
let runnerOverride: SideRunner | null = null;

export function setSideChatTestHooks(next: { engine?: ((record: ChatRecord) => PiEngine) | null; runner?: SideRunner | null }): void {
	if ("engine" in next) engineOverride = next.engine ?? null;
	if ("runner" in next) runnerOverride = next.runner ?? null;
}

const live = new Map<string, AbortController>();

function liveKey(chatId: string, threadId: string): string {
	return `${chatId}\n${threadId}`;
}

function engineFor(record: ChatRecord): PiEngine | Response {
	if (engineOverride) return engineOverride(record);
	const effective = effectiveSettings();
	const spec = resolveConversationSpec(record.settings, effective.models.strong);
	if (!spec) return Response.json({ error: "No conversation model is selected." }, { status: 409 });
	try {
		return piEngineForSpec(spec, false);
	} catch (err) {
		const message = err instanceof Error ? err.message : "The conversation model is unavailable.";
		return Response.json({ error: message }, { status: 409 });
	}
}

function instructionsFor(): string {
	const settings = effectiveSettings();
	return composeSideChatInstructions(settings.agent?.prompts ?? {}, sideChatLanguage(settings.general?.language));
}

function replaceThread(chatId: string, thread: SideChatThread): SideChatThread | null {
	const stored = stores.chatStore.updateSideChats(chatId, (current) => current.some((entry) => entry.id === thread.id)
		? current.map((entry) => entry.id === thread.id ? thread : entry)
		: [...current, thread]);
	return stored?.sideChats?.find((entry) => entry.id === thread.id) ?? null;
}

export async function runSideAnswer(chatId: string, threadId: string): Promise<void> {
	const record = stores.chatStore.getChat(chatId);
	const thread = record?.sideChats?.find((entry) => entry.id === threadId);
	if (!record || !thread) return;
	const last = thread.messages.at(-1);
	const retry = last?.role === "assistant" && last.error !== undefined;
	if (!retry && !sideThreadAwaitsAnswer(thread)) return;
	const engine = engineFor(record);
	if (engine instanceof Response) return;
	const modelThread = retry
		? { ...thread, messages: thread.messages.slice(0, thread.messages.findLastIndex((message) => message.role === "user") + 1) }
		: thread;
	const turns = sideChatModelTurns(modelThread, sideChatLessonDocument(record.messages));
	const answerId = newMessageId();
	const model = `${engine.model.provider}:${engine.model.id}`;
	const controller = new AbortController();
	live.set(liveKey(chatId, threadId), controller);
	let pending: SideChatThread = {
		...thread,
		messages: [...thread.messages, { id: answerId, role: "assistant", text: "", at: new Date().toISOString(), model, pending: true }],
	};
	replaceThread(chatId, pending);
	let result: SideAnswerResult;
	try {
		result = await (runnerOverride ?? streamSideAnswer)({
			engine,
			instructions: instructionsFor(),
			turns,
			signal: controller.signal,
			chatId,
			runId: answerId,
			onText: (text) => {
				pending = { ...pending, messages: pending.messages.map((message) => message.id === answerId ? { ...message, text } : message) };
				replaceThread(chatId, pending);
			},
		});
	} finally {
		live.delete(liveKey(chatId, threadId));
	}
	const at = new Date().toISOString();
	const answer: SideChatMessage = {
		id: answerId,
		role: "assistant",
		text: result.text,
		at,
		model,
		...(result.outcome === "aborted" ? { stopped: true } : {}),
		...(result.outcome === "error" ? { error: result.errorMessage ?? "The model call failed." } : {}),
	};
	replaceThread(chatId, { ...pending, messages: pending.messages.map((message) => message.id === answerId ? answer : message) });
	const usage = result.usage;
	if (usage && result.outcome === "done") {
		try {
			stores.chatStore.appendTurnUsage(chatId, {
				id: answerId,
				messageId: answerId,
				at,
				model,
				steps: [{
					inputTokens: usage.input,
					outputTokens: usage.output,
					cacheReadTokens: usage.cacheRead,
					cacheWriteTokens: usage.cacheWrite,
					cacheWrite1hTokens: usage.cacheWrite1h ?? 0,
					reasoningTokens: usage.reasoning ?? 0,
				}],
			});
		} catch { /* a deleted session has nowhere to record the spend */ }
	}
}

function threadForAsk(record: ChatRecord, input: SideAskInput): SideChatThread | Response {
	const threads = record.sideChats ?? [];
	let target = input.threadId ? threads.find((thread) => thread.id === input.threadId) : undefined;
	if (input.threadId && !target) return Response.json({ error: "Unknown side conversation" }, { status: 404 });
	if (!target && input.anchor) {
		const segment = sideSegmentId(record.messages, input.anchor.messageId);
		if (!segment) return Response.json({ error: "The source is not a teaching segment in this session" }, { status: 400 });
		const source = record.messages.find((message) => message.id === segment && message.role === "assistant");
		const blockText = userFacingTextOf(source?.content ?? [], failedOutputCallIds(record.messages)).join("\n\n").slice(0, 4_000) || "This teaching segment and its associated question.";
		target = threads.find((thread) => thread.anchor.messageId === segment) ?? newSideThread({
			...input.anchor,
			messageId: segment,
			partId: `${segment}-t0`,
			blockIndex: 0,
			blockText,
		});
	}
	if (!target) return Response.json({ error: "A teaching segment or threadId is required" }, { status: 400 });
	if (input.quoteCitations) {
		if (input.quoteCitations.length !== input.quotes.length) return Response.json({ error: "Quote sources do not match the passages" }, { status: 400 });
		for (const [index, link] of input.quoteCitations.entries()) {
			const citations = collectCitations(link);
			const citation = citations[0]?.citation;
			const source = citation && record.messages.find((message) => message.id === citation.messageId && message.role === "assistant");
			if (citations.length !== 1 || citations[0]!.source !== link || !citation || citation.chatId !== record.id || citation.text.trim() !== input.quotes[index] || !source || sideSegmentId(record.messages, source.id) !== target.anchor.messageId) {
				return Response.json({ error: "The quoted source is not in this teaching segment" }, { status: 400 });
			}
		}
	}
	return target;
}

export async function askSideChat(chatId: string, raw: unknown): Promise<Response> {
	let input: SideAskInput;
	try {
		input = parseSideAskInput(raw);
	} catch (err) {
		if (err instanceof SideChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}
	const initial = stores.chatStore.getChat(chatId);
	if (!initial) return Response.json({ error: "Unknown chat" }, { status: 404 });
	const engine = engineFor(initial);
	if (engine instanceof Response) return engine;
	const record = stores.chatStore.getChat(chatId);
	if (!record) return Response.json({ error: "Unknown chat" }, { status: 404 });
	const resolved = threadForAsk(record, input);
	if (resolved instanceof Response) return resolved;
	if (input.requestId && resolved.messages.some((message) => message.id === input.requestId || message.requestId === input.requestId)) {
		return Response.json({ thread: resolved });
	}
	if (resolved.runId || live.has(liveKey(chatId, resolved.id))) {
		return Response.json({ error: "This side conversation is still being answered" }, { status: 409 });
	}
	let thread = resolved;
	let modelThread = resolved;
	if (input.retry) {
		const last = resolved.messages.at(-1);
		if (last?.role === "assistant" && last.error !== undefined) {
			modelThread = { ...resolved, messages: resolved.messages.slice(0, resolved.messages.findLastIndex((message) => message.role === "user") + 1) };
		} else if (!sideThreadAwaitsAnswer(resolved)) {
			return Response.json({ error: "Nothing to retry" }, { status: 409 });
		}
	} else {
		const question = newSideQuestion(input.text, input.quotes);
		if (input.quoteCitations?.length) question.quoteCitations = [...input.quoteCitations];
		if (input.requestId) {
			question.id = input.requestId;
			question.requestId = input.requestId;
		}
		thread = { ...resolved, open: true, messages: [...resolved.messages, question] };
		modelThread = thread;
	}
	const turns = sideChatModelTurns(modelThread, sideChatLessonDocument(record.messages));
	if (input.working?.trim() && turns.length > 0) turns[turns.length - 1]!.text += `\n\nLearner's current working (not submitted):\n${input.working.trim()}`;
	const instructions = instructionsFor();
	const estimatedTokens = Math.ceil((instructions.length + turns.reduce((sum, turn) => sum + turn.text.length, 0)) / 4);
	const reserve = Math.min(COMPACTION_RESERVE_TOKENS, engine.model.maxTokens ?? COMPACTION_RESERVE_TOKENS);
	if ((engine.model.contextWindow ?? 0) > 0 && estimatedTokens > Math.max(1, engine.model.contextWindow - reserve)) {
		return Response.json({ error: "This side conversation and lesson exceed the selected model's context window. Select a model with a larger context window." }, { status: 400 });
	}
	if (!replaceThread(chatId, thread)) return Response.json({ error: "Unknown chat" }, { status: 404 });
	const { hostedSessions } = await import("./session/http.ts");
	if (hostedSessions()) {
		const { start } = await import("workflow/api");
		const { sideChatWorkflow } = await import("./session/side-workflows.ts");
		const userId = activeUserId();
		const run = await start(sideChatWorkflow, userId ? [chatId, thread.id, userId] : [chatId, thread.id]);
		const stored = replaceThread(chatId, { ...thread, runId: run.runId });
		return Response.json({ thread: stored ?? thread });
	}
	await runSideAnswer(chatId, thread.id);
	publishSideEntries(chatId);
	const settled = stores.chatStore.getChat(chatId)?.sideChats?.find((entry) => entry.id === thread.id) ?? thread;
	return Response.json({ thread: settled });
}

export async function stopSideChat(chatId: string, threadId: string): Promise<Response> {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return Response.json({ error: "Unknown chat" }, { status: 404 });
	const thread = record.sideChats?.find((entry) => entry.id === threadId);
	if (!thread) return Response.json({ error: "Unknown side conversation" }, { status: 404 });
	live.get(liveKey(chatId, threadId))?.abort();
	if (thread.runId) {
		try {
			const { cancelRun } = await import("./session/wake.ts");
			await cancelRun(thread.runId);
		} catch { /* the run already finished */ }
	}
	const stopped = thread.messages.map((message) => message.pending ? { ...message, pending: false, stopped: true } : message);
	const stored = replaceThread(chatId, { ...thread, runId: undefined, messages: stopped });
	return Response.json({ thread: stored ?? thread });
}

export function setSideChatOpen(chatId: string, threadId: string, raw: unknown): Response {
	let open: boolean;
	try {
		open = parseSideOpenInput(raw);
	} catch (err) {
		if (err instanceof SideChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}
	const record = stores.chatStore.getChat(chatId);
	if (!record) return Response.json({ error: "Unknown chat" }, { status: 404 });
	const thread = record.sideChats?.find((entry) => entry.id === threadId);
	if (!thread) return Response.json({ error: "Unknown side conversation" }, { status: 404 });
	const stored = replaceThread(chatId, { ...thread, open });
	return Response.json({ thread: stored ?? thread });
}

export function listSideChats(chatId: string): Response {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return Response.json({ error: "Unknown chat" }, { status: 404 });
	return Response.json({ threads: record.sideChats ?? [] });
}
