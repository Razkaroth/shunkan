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
export async function turnWorkflow(chatId: string): Promise<void> {
	"use workflow";
	console.log(`[turn ${chatId}] start`);
	try {
		for (;;) {
			const outcome = await runGenerationStep(chatId);
			if (!outcome.continue) break;
		}
		await applySettlementStep(chatId);
		const plan = await sideRunPlanStep(chatId);
		if (plan.extraction) {
			const child = await start(extractionWorkflow, [chatId]);
			await rememberExtractionRunStep(chatId, child.runId);
		}
		if (plan.compaction) {
			const child = await start(compactionWorkflow, [chatId]);
			await rememberCompactionRunStep(chatId, child.runId);
		}
		await closeTurnStreamStep(chatId);
		await clearTurnRunStep(chatId);
	} catch (error) {
		console.error(`[turn ${chatId}] failed`, error);
		await closeTurnStreamStep(chatId);
		await clearTurnRunStep(chatId);
		if (FatalError.is(error)) return;
		throw error;
	}
}
