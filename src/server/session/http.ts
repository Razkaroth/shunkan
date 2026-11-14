import type { LhMessage } from "../../core/native-messages.ts";
import { stores } from "../stores.ts";
import { settledTurnResponse } from "../turn-runs.ts";
import { compactionChildOpen, runIsOpen, turnChildOpen } from "./liveness.ts";
import { cancelRun, startJobWorkflow, wakeSession } from "./wake.ts";

export { startJobWorkflow, wakeSession };

export function hostedSessions(): boolean {
	return process.env.NODE_ENV !== "test";
}

const SSE_HEADERS = {
	"Content-Type": "text/event-stream",
	"Cache-Control": "no-cache, no-transform",
	"X-Accel-Buffering": "no",
};

/** A live turn child's stream, from the start. A finished or missing run is the settled terminal. */
export async function hostedTurnResponse(chatId: string): Promise<Response> {
	const runId = stores.chatStore.getChat(chatId)?.turnRunId;
	if (!runId || !(await runIsOpen(runId))) return settledTurnResponse(chatId);
	const { getRun } = await import("workflow/api");
	return new Response(getRun(runId).getReadable() as unknown as ReadableStream, { headers: SSE_HEADERS });
}

/** Park a user steer on the chat. Does not resume the session; the next generation reads the record. */
export async function appendPendingSteer(chatId: string, message: LhMessage): Promise<boolean> {
	if (!(await turnChildOpen(chatId))) return false;
	const record = stores.chatStore.getChat(chatId);
	if (!record) return false;
	if ((record.pendingSteers ?? []).some((saved) => saved.id === message.id)) return true;
	if (record.messages.some((saved) => saved.id === message.id)) return true;
	stores.chatStore.patchChat(chatId, { pendingSteers: [...(record.pendingSteers ?? []), message] });
	return true;
}

export async function cancelTurnRun(chatId: string): Promise<{ ok: true } | { ok: false; reason: "not_running" }> {
	const runId = stores.chatStore.getChat(chatId)?.turnRunId;
	if (!runId || !(await runIsOpen(runId))) return { ok: false, reason: "not_running" };
	await cancelRun(runId);
	return { ok: true };
}

export async function cancelJobRun(jobId: string): Promise<void> {
	const runId = stores.jobStore.getJob(jobId)?.runId;
	if (!runId || !(await runIsOpen(runId))) return;
	try {
		await cancelRun(runId);
	} catch (error) {
		console.error(`[job ${jobId}] cancel failed`, error);
	}
}

export { compactionChildOpen, turnChildOpen };
