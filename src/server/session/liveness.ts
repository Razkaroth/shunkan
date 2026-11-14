import { getRun } from "workflow/api";
import { isTurnRunning } from "../turn-liveness.ts";
import { stores } from "../stores.ts";

/** A run is live while it is pending or running. A missing run is not. */
export async function runIsOpen(runId: string): Promise<boolean> {
	try {
		const status = await getRun(runId).status;
		return status === "pending" || status === "running";
	} catch (error) {
		console.error(`[run ${runId}] status unreadable`, error);
		return false;
	}
}

/**
 * A turn child is open when its run id is stored and that run has not finished.
 * In the test runner a stored id counts as live (there is no world); with no id,
 * the in-process registry is the fallback the existing step tests already drive.
 */
export async function turnChildOpen(chatId: string): Promise<boolean> {
	const runId = stores.chatStore.getChat(chatId)?.turnRunId;
	if (process.env.NODE_ENV === "test") {
		if (runId) return true;
		return isTurnRunning(chatId);
	}
	if (!runId) return false;
	const open = await runIsOpen(runId);
	if (!open) stores.chatStore.patchChat(chatId, { turnRunId: null });
	return open;
}

/** Compaction's single flight: a stored child run that has not finished. */
export async function compactionChildOpen(chatId: string): Promise<boolean> {
	const runId = stores.chatStore.getChat(chatId)?.compactionRunId;
	if (!runId) return false;
	if (process.env.NODE_ENV === "test") return true;
	const open = await runIsOpen(runId);
	if (!open) stores.chatStore.patchChat(chatId, { compactionRunId: null });
	return open;
}
