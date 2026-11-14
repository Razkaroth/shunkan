import { start } from "workflow/api";
import { FatalError } from "workflow";
import { compactionWorkflow, extractionWorkflow } from "./side-workflows.ts";
import {
	applySettlementStep,
	clearTurnRunStep,
	closeTurnStreamStep,
	rememberCompactionRunStep,
	rememberExtractionRunStep,
	runGenerationStep,
	sideRunPlanStep,
} from "./steps.ts";

/** One turn: a sequence of one-generation steps, then settlement. Its stream is one turn. */
export async function turnWorkflow(chatId: string, userId?: string): Promise<void> {
	"use workflow";
	console.log(`[turn ${chatId}] start`);
	try {
		for (;;) {
			const outcome = await runGenerationStep(chatId, userId);
			if (!outcome.continue) break;
		}
		await applySettlementStep(chatId, userId);
		const plan = await sideRunPlanStep(chatId, userId);
		if (plan.extraction) {
			const child = await start(extractionWorkflow, userId ? [chatId, userId] : [chatId]);
			await rememberExtractionRunStep(chatId, child.runId, userId);
		}
		if (plan.compaction) {
			const child = await start(compactionWorkflow, userId ? [chatId, userId] : [chatId]);
			await rememberCompactionRunStep(chatId, child.runId, userId);
		}
		await closeTurnStreamStep(chatId, userId);
		await clearTurnRunStep(chatId, userId);
	} catch (error) {
		console.error(`[turn ${chatId}] failed`, error);
		await closeTurnStreamStep(chatId, userId);
		await clearTurnRunStep(chatId, userId);
		if (FatalError.is(error)) return;
		throw error;
	}
}
