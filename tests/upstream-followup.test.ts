import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { askSideChat, setSideChatTestHooks } from "../src/server/side-chat.ts";
import { flashcardsGenerate, flashcardsReview, flashcardsWrite, setFlashcardRunner } from "../src/server/flashcards.ts";
import { stores } from "../src/server/stores.ts";
import { parseChatInput } from "../src/core/input-events.ts";
import { richCodeDecision } from "../src/core/rich-code.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import type { PiEngine } from "../src/agent/models.ts";

const engine = { model: { provider: "test", id: "test", contextWindow: 100_000, maxTokens: 4_000 } } as unknown as PiEngine;

after(() => {
	setSideChatTestHooks({ engine: null, runner: null });
	setFlashcardRunner(null);
});

function assistant(id: string): LhMessage {
	return {
		id,
		role: "assistant",
		content: [{ type: "text", text: "A teaching passage about atoms." }],
		stopReason: "stop",
		timestamp: 1,
		provider: "test",
		model: "test",
	} as unknown as LhMessage;
}

describe("side chats", () => {
	it("answers in process and folds the exchange into the teacher transcript once", async () => {
		const chat = stores.chatStore.createChat("Side");
		stores.chatStore.saveMessages(chat.id, [assistant("teacher1")]);
		setSideChatTestHooks({
			engine: () => engine,
			runner: async (opts) => {
				opts.onText?.("A short clarification.");
				return { text: "A short clarification.", outcome: "done" };
			},
		});
		const first = await askSideChat(chat.id, {
			anchor: { messageId: "teacher1", partId: "teacher1-t0", blockIndex: 0, blockText: "atoms" },
			text: "What does this mean?",
			quotes: [],
			requestId: "req_side_1",
		});
		assert.equal(first.status, 200);
		const again = await askSideChat(chat.id, {
			anchor: { messageId: "teacher1", partId: "teacher1-t0", blockIndex: 0, blockText: "atoms" },
			text: "What does this mean?",
			quotes: [],
			requestId: "req_side_1",
		});
		const body = await again.json() as { thread: { messages: Array<{ role: string }> } };
		assert.equal(body.thread.messages.filter((message) => message.role === "user").length, 1);
		const record = stores.chatStore.getChat(chat.id);
		assert.equal(record?.messages.filter((message) => message.role === "custom" && message.customType === "side-question").length, 2);
	});
});

describe("flashcards", () => {
	it("reviews an existing card without calling a model and generates through the runner", async () => {
		let calls = 0;
		setFlashcardRunner(async () => {
			calls += 1;
			return JSON.stringify({ propositions: [{ propositionId: "n_atom", cards: [{ question: "What is in the nucleus?", answer: "Protons and neutrons." }] }] });
		});
		const created = await flashcardsWrite({ action: "create-deck", name: "Practice" }).json() as { decks: Array<{ id: string }> };
		await flashcardsWrite({ action: "add-card", deckId: created.decks[0]!.id, question: "2+2", answer: "4" });
		const added = await flashcardsWrite({ action: "add-card", deckId: created.decks[0]!.id, question: "2+2", answer: "4" }).json() as { cards: Array<{ propositionId: string }> };
		const reviewed = flashcardsReview({ propositionId: added.cards[0]!.propositionId, rating: 3 });
		assert.equal(reviewed.status, 200);
		assert.equal(calls, 0);
		stores.graphStore.appendNode({
			id: "n_atom",
			name: "Atom",
			statement: "An atom has a nucleus of protons and neutrons.",
			aliases: [],
			createdAt: new Date().toISOString(),
			provenance: [],
		});
		const generated = await flashcardsGenerate({ nodeIds: ["n_atom"] });
		assert.equal(generated.status, 200);
		assert.equal(calls, 1);
		const view = await generated.json() as { cards: Array<{ question: string }> };
		assert.ok(view.cards.some((card) => card.question === "What is in the nucleus?"));
	});
});

describe("remaining display ports", () => {
	it("keeps rich fences off until a family is enabled and caps an oversized source", () => {
		assert.equal(richCodeDecision("smiles", "CCO", {}), "off");
		assert.equal(richCodeDecision("smiles", "CCO", { chemicalStructures: true }), "render");
		assert.equal(richCodeDecision("tikz", "x".repeat(40_000), { technicalDiagrams: true }), "too-big");
	});

	it("accepts a png drawing on a text send", () => {
		const parsed = parseChatInput({ type: "text", text: "see this", images: [{ data: "aGVsbG8=", mimeType: "image/png" }] });
		assert.equal(parsed.type, "text");
		if (parsed.type === "text") assert.equal(parsed.images?.[0]?.mimeType, "image/png");
	});
});
