import { createHook, sleep } from "workflow";
import { start } from "workflow/api";
import { HookForceClaimedError } from "workflow/errors";
import type { SessionHint } from "./hints.ts";
import { clearTurnRunStep, decideWakeStep, rememberTurnRunStep, rereadAfterGraceStep } from "./steps.ts";
import { turnWorkflow } from "./turn-workflow.ts";

/**
 * One chat's durable session. The token is `session:${chatId}`.
 * This is the only `"use workflow"` function in the session module.
 * Turn, job, extraction, and compaction runs are child workflows.
 */
export async function sessionWorkflow(chatId: string, mode?: "force"): Promise<void> {
	"use workflow";
	console.log(`[session ${chatId}] open`, mode ?? "start");
	const token = `session:${chatId}`;
	const hook = mode === "force"
		? createHook<SessionHint>({ token, experimental_force: true })
		: createHook<SessionHint>({ token });
	try {
		const iterator = hook[Symbol.asyncIterator]();
		let incoming: Promise<IteratorResult<SessionHint>> | undefined;
		const pull = () => (incoming ??= iterator.next());
		for (;;) {
			const pulled = await pull();
			if (pulled.done) return;
			incoming = undefined;
			const decision = await decideWakeStep(chatId, pulled.value);
			if (decision.action === "wait") continue;
			if (decision.action === "grace") {
				const next = pull();
				const winner = await Promise.race([
					sleep("750ms").then(() => "slept" as const),
					next.then(() => "hint" as const),
				]);
				const after = await rereadAfterGraceStep(chatId, decision.messageIds);
				let pending: Promise<IteratorResult<SessionHint>> | undefined = next;
				if (winner === "hint") {
					await next;
					pending = undefined;
					incoming = undefined;
				}
				if (after === "turn") await runTurn(chatId);
				if (pending) {
					const late = await Promise.race([
						pending.then(() => "ready" as const),
						Promise.resolve("pending" as const),
					]);
					if (late === "ready") {
						await pending;
						incoming = undefined;
					}
				}
				continue;
			}
			await runTurn(chatId);
		}
	} catch (error) {
		if (HookForceClaimedError.is(error)) return;
		throw error;
	}
}

async function runTurn(chatId: string): Promise<void> {
	const child = await start(turnWorkflow, [chatId]);
	await rememberTurnRunStep(chatId, child.runId);
	try {
		await child.returnValue;
	} catch (error) {
		console.error(`[session ${chatId}] turn child failed`, error);
		await clearTurnRunStep(chatId);
	}
}
