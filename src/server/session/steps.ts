import { getWritable } from "workflow";
import { runAsUser } from "../../../config.ts";
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
import { runIsOpen } from "./liveness.ts";

/** Learner records are scoped to the signed-in profile. A step runs outside the request, so re-enter that scope. */
function asUser<T>(userId: string | undefined, fn: () => T): T {
	return userId ? runAsUser(userId, fn) : fn();
}

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
export async function decideWakeStep(chatId: string, hint: SessionHint, userId?: string): Promise<WakeDecision> {
	"use step";
	return asUser(userId, () => decideWake(chatId, hint));
}

function decideWake(chatId: string, hint: SessionHint): WakeDecision {
	console.log(`[session ${chatId}] decide`, hint.kind);
	const record = stores.chatStore.getChat(chatId);
	if (!record) return { action: "wait" };
	if (held(record.messages)) return { action: "wait" };
	if (hint.kind === "job") return { action: "grace", messageIds: record.messages.map((message) => message.id) };
	return { action: "turn" };
}

/** After the job grace, a learner message that landed wins; an idle record does not start a turn. */
export async function rereadAfterGraceStep(chatId: string, beforeIds: string[], userId?: string): Promise<"turn" | "wait"> {
	"use step";
	return asUser(userId, () => rereadAfterGrace(chatId, beforeIds));
}

function rereadAfterGrace(chatId: string, beforeIds: string[]): "turn" | "wait" {
	console.log(`[session ${chatId}] reread`);
	const record = stores.chatStore.getChat(chatId);
	if (!record || held(record.messages)) return "wait";
	const before = new Set(beforeIds);
	const landed = record.messages.some((message) => !before.has(message.id) && message.role !== "custom");
	if (landed || pendingWork(chatId, record.messages)) return "turn";
	return "wait";
}

export async function rememberTurnRunStep(chatId: string, runId: string, userId?: string): Promise<void> {
	"use step";
	asUser(userId, () => {
		console.log(`[session ${chatId}] turn run ${runId}`);
		stores.chatStore.patchChat(chatId, { turnRunId: runId });
	});
}

export async function clearTurnRunStep(chatId: string, userId?: string): Promise<void> {
	"use step";
	asUser(userId, () => {
		console.log(`[session ${chatId}] turn clear`);
		stores.chatStore.patchChat(chatId, { turnRunId: null });
	});
}

export async function runGenerationStep(chatId: string, userId?: string): Promise<{ continue: boolean }> {
	"use step";
	return asUser(userId, () => runGeneration(chatId));
}

async function runGeneration(chatId: string): Promise<{ continue: boolean }> {
	const writer = getWritable<Uint8Array>().getWriter();
	const sink: GenerationWriter = { write: (chunk) => writer.write(chunk) };
	try {
		return await runOneGeneration(chatId, sink);
	} finally {
		writer.releaseLock();
	}
}

export async function applySettlementStep(chatId: string, userId?: string): Promise<void> {
	"use step";
	asUser(userId, () => {
		console.log(`[turn ${chatId}] settle`);
		applyParkedDismissal(stores.chatStore, chatId);
	});
}

export async function sideRunPlanStep(chatId: string, userId?: string): Promise<{ extraction: boolean; compaction: boolean }> {
	"use step";
	return asUser(userId, () => sideRunPlan(chatId));
}

async function sideRunPlan(chatId: string): Promise<{ extraction: boolean; compaction: boolean }> {
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

export async function rememberExtractionRunStep(chatId: string, runId: string, userId?: string): Promise<void> {
	"use step";
	asUser(userId, () => {
		stores.chatStore.patchChat(chatId, { extractionRunId: runId });
	});
}

export async function rememberCompactionRunStep(chatId: string, runId: string, userId?: string): Promise<void> {
	"use step";
	asUser(userId, () => {
		stores.chatStore.patchChat(chatId, { compactionRunId: runId });
	});
}

export async function clearExtractionRunStep(chatId: string, userId?: string): Promise<void> {
	"use step";
	asUser(userId, () => {
		stores.chatStore.patchChat(chatId, { extractionRunId: null });
	});
}

export async function clearCompactionRunStep(chatId: string, userId?: string): Promise<void> {
	"use step";
	asUser(userId, () => {
		stores.chatStore.patchChat(chatId, { compactionRunId: null });
	});
}

export async function runExtractionStep(chatId: string, userId?: string): Promise<void> {
	"use step";
	await asUser(userId, async () => {
		console.log(`[extraction ${chatId}] run`);
		await extraction.runExtraction(chatId);
	});
}

export async function runCompactionStep(chatId: string, userId?: string): Promise<void> {
	"use step";
	await asUser(userId, async () => {
		console.log(`[compaction ${chatId}] run`);
		const deps = compactionDeps(chatId);
		if (!deps) return;
		await ensureCompacted(deps, chatId);
	});
}

export async function runJobBodyStep(jobId: string, userId?: string): Promise<void> {
	"use step";
	await asUser(userId, async () => {
		console.log(`[job ${jobId}] run`);
		const job = stores.jobStore.getJob(jobId);
		if (!job || job.kind === "demo" || job.kind === "visual") return;
		await jobRunner.runJob(jobId);
	});
}

export async function resumeSessionForJobStep(jobId: string, userId?: string): Promise<void> {
	"use step";
	await asUser(userId, async () => {
		const job = stores.jobStore.getJob(jobId);
		if (!job) return;
		console.log(`[job ${jobId}] resume session ${job.chatId}`);
		const { wakeSession } = await import("./wake.ts");
		await wakeSession(job.chatId, { kind: "job" });
	});
}

export async function closeTurnStreamStep(chatId: string, userId?: string): Promise<void> {
	"use step";
	await asUser(userId, async () => {
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
	});
}
