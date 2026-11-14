import { resumeSessionForJobStep, runJobBodyStep } from "./steps.ts";

/** One research or pdf job. The run id on the job row is the sweep's lock. */
export async function jobWorkflow(jobId: string, userId?: string): Promise<void> {
	"use workflow";
	console.log(`[job ${jobId}] start`);
	await runJobBodyStep(jobId, userId);
	await resumeSessionForJobStep(jobId, userId);
}
