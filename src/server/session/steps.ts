import { getWritable } from "workflow";
import { resumeHook } from "workflow/api";
import { coverageOf } from "../../core/coverage.ts";
import { endsInDismissal, endsInQuestionRecovery, hasUnresolvedQuestion, type LhMessage } from "../../core/native-messages.ts";
import { extractionEnabled } from "../../core/settings-resolution.ts";
import { applyParkedDismissal } from "../dismissal-park.ts";
import { ensureCompacted } from "../compaction.ts";
import { effectiveSettings, stores } from "../stores.ts";
import { extraction, jobRunner } from "../chat-handler.ts";
import { compactionDeps } from "./compaction-deps.ts";
import { runOneGeneration, type GenerationWriter } from "./generation.ts";
import type { SessionHint } from "./hints.ts";
import { sessionToken } from "./hints.ts";
import { runIsOpen } from "./liveness.ts";

export type WakeDecision =
	| { action: "wait" }
	| { action: "turn" }
	| { action: "grace"; messageIds: string[] };

function held(messages: readonly LhMessage[]): boolean {
	return hasUnresolvedQuestion(messages) || endsInDismissal(messages) || endsInQuestionRecovery(messages);
}

function pendingWork(chatId: string, messages: readonly LhMessage[]): boolean {
	const record = stores.chatStore.getChat(chatId);
	if ((record?.pendingSteers ?? []).some((message) => !messages.some((saved) => saved.id === message.id))) return true;
	return stores.jobStore.listJobs(chatId).some((job) => job.delivery?.status === "pending");
}

/** Re-read the record and decide whether this hint may start a turn. */
export async function decideWakeStep(chatId: string, hint: SessionHint): Promise<WakeDecision> {
	"use step";
	console.log(`[session ${chatId}] decide`, hint.kind);
	const record = stores.chatStore.getChat(chatId);
	if (!record) return { action: "wait" };
	if (held(record.messages)) return { action: "wait" };
	if (hint.kind === "job") return { action: "grace", messageIds: record.messages.map((message) => message.id) };
	return { action: "turn" };
}

/** After the job grace, a learner message that landed wins; an idle record does not start a turn. */
export async function rereadAfterGraceStep(chatId: string, beforeIds: string[]): Promise<"turn" | "wait"> {
	"use step";
	console.log(`[session ${chatId}] reread`);
	const record = stores.chatStore.getChat(chatId);
	if (!record || held(record.messages)) return "wait";
	const before = new Set(beforeIds);
	const landed = record.messages.some((message) => !before.has(message.id) && message.role !== "custom");
	if (landed || pendingWork(chatId, record.messages)) return "turn";
	return "wait";
}

export async function rememberTurnRunStep(chatId: string, runId: string): Promise<void> {
	"use step";
	console.log(`[session ${chatId}] turn run ${runId}`);
	stores.chatStore.patchChat(chatId, { turnRunId: runId });
}

export async function clearTurnRunStep(chatId: string): Promise<void> {
	"use step";
	console.log(`[session ${chatId}] turn clear`);
	stores.chatStore.patchChat(chatId, { turnRunId: null });
}

export async function runGenerationStep(chatId: string): Promise<{ continue: boolean }> {
	"use step";
	const writer = getWritable<Uint8Array>().getWriter();
	const sink: GenerationWriter = { write: (chunk) => writer.write(chunk) };
	try {
		return await runOneGeneration(chatId, sink);
	} finally {
		writer.releaseLock();
	}
}

export async function applySettlementStep(chatId: string): Promise<void> {
	"use step";
	console.log(`[turn ${chatId}] settle`);
	applyParkedDismissal(stores.chatStore, chatId);
}

export async function sideRunPlanStep(chatId: string): Promise<{ extraction: boolean; compaction: boolean }> {
	"use step";
	if (process.env.NODE_ENV === "test") return { extraction: false, compaction: false };
	const record = stores.chatStore.getChat(chatId);
	if (!record) return { extraction: false, compaction: false };
	const settings = effectiveSettings();
	const extractionOpen = record.extractionRunId ? await runIsOpen(record.extractionRunId) : false;
	if (record.extractionRunId && !extractionOpen) stores.chatStore.patchChat(chatId, { extractionRunId: null });
	const compactionOpen = record.compactionRunId ? await runIsOpen(record.compactionRunId) : false;
	if (record.compactionRunId && !compactionOpen) stores.chatStore.patchChat(chatId, { compactionRunId: null });
	const covered = coverageOf(record.messages, stores.graphStore.readCoverage(), chatId);
	const extract = record.kind !== "practice"
		&& extractionEnabled(settings.graph)
		&& !extractionOpen
		&& covered.uncoveredTokens >= settings.graph.extractionChunkTokens;
	return { extraction: extract, compaction: !compactionOpen };
}

export async function rememberExtractionRunStep(chatId: string, runId: string): Promise<void> {
	"use step";
	stores.chatStore.patchChat(chatId, { extractionRunId: runId });
}

export async function rememberCompactionRunStep(chatId: string, runId: string): Promise<void> {
	"use step";
	stores.chatStore.patchChat(chatId, { compactionRunId: runId });
}

export async function clearExtractionRunStep(chatId: string): Promise<void> {
	"use step";
	stores.chatStore.patchChat(chatId, { extractionRunId: null });
}

export async function clearCompactionRunStep(chatId: string): Promise<void> {
	"use step";
	stores.chatStore.patchChat(chatId, { compactionRunId: null });
}

export async function runExtractionStep(chatId: string): Promise<void> {
	"use step";
	console.log(`[extraction ${chatId}] run`);
	await extraction.runExtraction(chatId);
}

export async function runCompactionStep(chatId: string): Promise<void> {
	"use step";
	console.log(`[compaction ${chatId}] run`);
	const deps = compactionDeps(chatId);
	if (!deps) return;
	await ensureCompacted(deps, chatId);
}

export async function runJobBodyStep(jobId: string): Promise<void> {
	"use step";
	console.log(`[job ${jobId}] run`);
	const job = stores.jobStore.getJob(jobId);
	if (!job || job.kind === "demo" || job.kind === "visual") return;
	await jobRunner.runJob(jobId);
}

export async function resumeSessionForJobStep(jobId: string): Promise<void> {
	"use step";
	const job = stores.jobStore.getJob(jobId);
	if (!job) return;
	console.log(`[job ${jobId}] resume session ${job.chatId}`);
	await resumeHook(sessionToken(job.chatId), { kind: "job" });
}

export async function closeTurnStreamStep(chatId: string): Promise<void> {
	"use step";
	console.log(`[turn ${chatId}] close`);
	const writer = getWritable<Uint8Array>().getWriter();
	try {
		await writer.write(new TextEncoder().encode("data: [DONE]\n\n"));
		await writer.close();
	} catch (error) {
		console.error(`[turn ${chatId}] stream close failed`, error);
		writer.releaseLock();
	}
	stores.chatStore.patchChat(chatId, { turnRunId: null });
}
