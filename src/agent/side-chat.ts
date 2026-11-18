/**
 * A tool-less side answer on the session's conversation model.
 * A fresh session id is passed so a provider that requires one can run.
 * It is not the lesson's session, so the lesson's live process is not reused.
 * Side-specific fragments are not user-editable. Shared voice, accuracy,
 * and formatting fragments honor the same override switches as the teacher.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeContext, type AssistantMessage, type Message, type Usage } from "@earendil-works/pi-ai";
import { providerEventObserver } from "./provider-events.ts";
import { PATHS } from "../../config.ts";
import { DEFAULT_LANGUAGE, isAppLanguage, type AppLanguage } from "../core/i18n.ts";
import type { SideModelTurn } from "../core/side-chat.ts";
import type { PiEngine } from "./models.ts";
import { readPromptOverride, resolveSegmentFile } from "./prompt-segments.ts";

const PROMPTS_DIR = path.join(PATHS.root, "src", "agent", "prompts");
const SIDE_BASE = path.join(PROMPTS_DIR, "side-chat", "00-base.md");
const SIDE_STYLE = path.join(PROMPTS_DIR, "side-chat", "90-style.md");
const SIDE_SHARED_FRAGMENTS = ["shared/10-voice.md", "shared/15-accuracy.md", "shared/40-formatting.md"];

function readSource(file: string): string {
	try {
		return fs.readFileSync(file, "utf-8");
	} catch {
		return "";
	}
}

export function composeSideChatInstructions(switches: Record<string, boolean> = {}, language: AppLanguage = DEFAULT_LANGUAGE): string {
	const segments = [readSource(resolveSegmentFile("side-chat/00-base.md", SIDE_BASE, language))];
	for (const key of SIDE_SHARED_FRAGMENTS) {
		const english = path.join(PROMPTS_DIR, ...key.split("/"));
		const override = switches[key] === true ? readPromptOverride(key) : null;
		segments.push(override ?? readSource(resolveSegmentFile(key, english, language)));
	}
	segments.push(readSource(resolveSegmentFile("side-chat/90-style.md", SIDE_STYLE, language)));
	return segments.map((s) => s.trim()).filter(Boolean).join("\n\n---\n\n");
}

export function sideChatLanguage(value: unknown): AppLanguage {
	return isAppLanguage(value) ? value : DEFAULT_LANGUAGE;
}

export interface SideAnswerResult {
	text: string;
	usage?: Usage;
	outcome: "done" | "aborted" | "error";
	errorMessage?: string;
}

function textOf(message: AssistantMessage): string {
	return message.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("");
}

export async function streamSideAnswer(opts: {
	engine: PiEngine;
	instructions: string;
	turns: readonly SideModelTurn[];
	signal?: AbortSignal;
	onText?: (text: string) => void;
	chatId?: string;
	runId?: string;
}): Promise<SideAnswerResult> {
	const now = Date.now();
	const messages: Message[] = opts.turns.map((turn) =>
		turn.role === "user"
			? { role: "user", content: turn.text, timestamp: now }
			: ({
					role: "assistant",
					content: [{ type: "text", text: turn.text }],
					api: opts.engine.model.api,
					provider: opts.engine.model.provider,
					model: opts.engine.model.id,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					stopReason: "stop",
					timestamp: now,
				} as AssistantMessage),
	);
	let text = "";
	let failure: unknown;
	const providerEvents = opts.chatId ? providerEventObserver(opts.chatId, "sideQuestion") : undefined;
	try {
		const stream = opts.engine.streamFn(opts.engine.model, normalizeContext({ systemPrompt: opts.instructions, messages, tools: [] }), {
			signal: opts.signal,
			sessionId: randomUUID(),
			...(providerEvents ? { onProviderStreamEvent: providerEvents } : {}),
		});
		for await (const event of stream) {
			if (event.type === "text_delta" || event.type === "text_end") {
				const next = textOf(event.partial);
				if (next !== text) {
					text = next;
					opts.onText?.(text);
				}
			} else if (event.type === "done") {
				return { text: textOf(event.message) || text, usage: event.message.usage, outcome: "done" };
			} else if (event.type === "error") {
				failure = new Error(event.error.errorMessage ?? event.reason);
				const partial = textOf(event.error) || text;
				if (event.reason === "aborted") return { text: partial, usage: event.error.usage, outcome: "aborted" };
				return { text: partial, usage: event.error.usage, outcome: "error", errorMessage: event.error.errorMessage ?? "The model call failed." };
			}
		}
		failure = new Error("The model stream ended without a result.");
		return { text, outcome: "error", errorMessage: (failure as Error).message };
	} catch (err) {
		failure = err;
		if (opts.signal?.aborted) return { text, outcome: "aborted" };
		return { text, outcome: "error", errorMessage: err instanceof Error ? err.message : String(err) };
	} finally {
		void failure;
	}
}
