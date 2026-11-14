import { clearCompactionRunStep, clearExtractionRunStep, runCompactionStep, runExtractionStep } from "./steps.ts";

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
