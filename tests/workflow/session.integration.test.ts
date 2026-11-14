import { resumeHook, start } from "workflow/api";
import { waitForHook } from "@workflow/vitest";
import { HookConflictError } from "workflow/errors";
import { describe, expect, it } from "vitest";
import { sessionWorkflow } from "../../src/server/session/workflow.ts";

describe("session workflow", () => {
	it("starts, resumes on session:${chatId}, and suspends with no turn running", async () => {
		const chatId = "chat_workflow_test";
		const token = `session:${chatId}`;
		const run = await start(sessionWorkflow, [chatId], { experimental_hook: { token } });
		const hook = await waitForHook(run, { token });
		expect(hook.token).toBe(token);
		await resumeHook(token, { kind: "input" });
		await expect.poll(async () => {
			try {
				await start(sessionWorkflow, [chatId], { experimental_hook: { token } });
				return "started";
			} catch (error) {
				return HookConflictError.is(error) && error.conflictingRunId === run.runId ? "held" : "other";
			}
		}, { timeout: 20_000, interval: 200 }).toBe("held");
		expect(await run.status).toBe("running");
	});
});
