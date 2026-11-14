import { clearCompactionRunStep, clearExtractionRunStep, runCompactionStep, runExtractionStep } from "./steps.ts";

/** Extraction child. The session does not await it. The run id is the single flight. */
export async function extractionWorkflow(chatId: string): Promise<void> {
	"use workflow";
	console.log(`[extraction ${chatId}] start`);
	try {
		await runExtractionStep(chatId);
	} finally {
		await clearExtractionRunStep(chatId);
	}
}

/** Compaction child. It runs during the pause after the turn settles. */
export async function compactionWorkflow(chatId: string): Promise<void> {
	"use workflow";
	console.log(`[compaction ${chatId}] start`);
	try {
		await runCompactionStep(chatId);
	} finally {
		await clearCompactionRunStep(chatId);
	}
}
