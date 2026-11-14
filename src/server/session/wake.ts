import { getRun, resumeHook, start } from "workflow/api";
import { HookConflictError, HookNotFoundError } from "workflow/errors";
import { activeUserId } from "../../../config.ts";
import { stores } from "../stores.ts";
import type { SessionHint } from "./hints.ts";
import { sessionToken } from "./hints.ts";
import { runIsOpen } from "./liveness.ts";
import { jobWorkflow } from "./job-workflow.ts";
import { sessionWorkflow } from "./workflow.ts";

/**
 * Start the session or deliver the hint to the run that already owns `session:${chatId}`.
 * A finished owner is replaced. If it still holds the token, the successor force-claims it.
 */
export async function wakeSession(chatId: string, hint: SessionHint): Promise<void> {
	const token = sessionToken(chatId);
	const userId = activeUserId();
	const stored = stores.chatStore.getChat(chatId)?.sessionRunId;
	if (stored && await runIsOpen(stored)) {
		await resumeHook(token, hint);
		return;
	}
	try {
		const run = await start(sessionWorkflow, userId ? [chatId, undefined, userId] : [chatId], { experimental_hook: { token } });
		stores.chatStore.patchChat(chatId, { sessionRunId: run.runId });
		await resumeHook(token, hint);
		return;
	} catch (error) {
		if (!HookConflictError.is(error)) throw error;
		const ownerId = error.conflictingRunId;
		if (!ownerId) throw error;
		if (await runIsOpen(ownerId)) {
			stores.chatStore.patchChat(chatId, { sessionRunId: ownerId });
			await resumeHook(token, hint);
			return;
		}
		await forceClaim(chatId, token, hint, userId);
	}
}

/** A new run, started without a start Hook, takes a token a finished owner still holds. */
async function forceClaim(chatId: string, token: string, hint: SessionHint, userId?: string): Promise<void> {
	const run = await start(sessionWorkflow, userId ? [chatId, "force", userId] : [chatId, "force"]);
	stores.chatStore.patchChat(chatId, { sessionRunId: run.runId });
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await resumeHook(token, hint);
			return;
		} catch (error) {
			if (!HookNotFoundError.is(error) || attempt === 2) throw error;
			await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
		}
	}
}

/** Start a research or pdf job workflow and store its run id before the body runs. */
export async function startJobWorkflow(jobId: string): Promise<void> {
	const job = stores.jobStore.getJob(jobId);
	if (!job || job.kind === "demo" || job.kind === "visual" || job.status !== "running") return;
	if (job.runId && await runIsOpen(job.runId)) return;
	const userId = activeUserId();
	const run = await start(jobWorkflow, userId ? [jobId, userId] : [jobId]);
	stores.jobStore.updateJob(jobId, { runId: run.runId });
}

export async function cancelRun(runId: string): Promise<void> {
	await getRun(runId).cancel();
}
