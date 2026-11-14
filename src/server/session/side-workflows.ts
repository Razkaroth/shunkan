import { clearCompactionRunStep, clearExtractionRunStep, clearSideRunStep, runCompactionStep, runExtractionStep, runSideAnswerStep, wakeSideStep } from "./steps.ts";

/** Extraction child. The session does not await it. The run id is the single flight. */
export async function extractionWorkflow(chatId: string, userId?: string): Promise<void> {
	"use workflow";
	console.log(`[extraction ${chatId}] start`);
	try {
		await runExtractionStep(chatId, userId);
	} finally {
		await clearExtractionRunStep(chatId, userId);
	}
}

/** One side answer. The run id on the thread is the single flight. Completing it wakes the session without starting a teacher turn on its own. */
export async function sideChatWorkflow(chatId: string, threadId: string, userId?: string): Promise<void> {
	"use workflow";
	console.log(`[side ${chatId}] ${threadId}`);
	try {
		await runSideAnswerStep(chatId, threadId, userId);
	} finally {
		await clearSideRunStep(chatId, threadId, userId);
		await wakeSideStep(chatId, userId);
	}
}

/** Compaction child. It runs during the pause after the turn settles. */
export async function compactionWorkflow(chatId: string, userId?: string): Promise<void> {
	"use workflow";
	console.log(`[compaction ${chatId}] start`);
	try {
		await runCompactionStep(chatId, userId);
	} finally {
		await clearCompactionRunStep(chatId, userId);
	}
}
