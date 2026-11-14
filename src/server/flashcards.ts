/**
 * Flashcards live in flashcards.json under the product data root.
 * Hosted runs persist that file through learner-records. Reviewing a card
 * only updates the FSRS schedule. Generation is the only path that calls a model.
 */

import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { normalizeContext, type AssistantMessage } from "@earendil-works/pi-ai";
import type { PiEngine } from "../agent/models.ts";
import { piEngineForSpec } from "../agent/models.ts";
import type { GraphNode } from "../core/contracts.ts";
import { resolveConversationSpec } from "../core/settings-resolution.ts";
import { existsSync, productPath, readFileSync, writeFileSync } from "../persistence/data-file.ts";
import { effectiveSettings, stores } from "./stores.ts";

const require = createRequire(import.meta.url);
const scheduler = require("../core/flashcards-scheduler.cjs") as {
	createSchedule: (now?: number) => Schedule;
	rate: (schedule: Schedule, rating: number, now: number, settings: Settings) => Schedule;
	isDue: (schedule: Schedule, now?: number, startHour?: number) => boolean;
	chooseCue: (cues: Cue[]) => Cue | null;
};
const prompts = require("../core/flashcards-prompts.cjs") as {
	graphInstructions: string;
	graphPromptFor: (input: { targets: unknown; propositions: unknown; chains: unknown; cards: Array<{ propositionId: string; active: unknown }> }) => string;
};

interface Settings {
	retention: number;
	learningSteps: number[];
	relearningSteps: number[];
	dayStart: number;
	fuzz: boolean;
	chunkBudget: number;
	modelOverride: string | null;
}

interface Cue {
	id: string;
	question: string;
	answer: string;
	deleted?: boolean;
}

interface Schedule {
	due: number;
	state: number;
	dueDay?: string;
	[key: string]: unknown;
}

interface Proposition {
	id: string;
	origin: "manual" | "graph";
	name: string;
	statement: string;
	cues: Cue[];
	schedule: Schedule;
	learningCueId: string | null;
}

interface Deck {
	id: string;
	name: string;
	newLimit: number;
	propositionIds: string[];
}

interface Review {
	propositionId: string;
	cueId: string;
	rating: number;
	at: string;
}

interface CardState {
	version: 1;
	revision: number;
	settings: Settings;
	decks: Deck[];
	propositions: Record<string, Proposition>;
	reviews: Review[];
	batches: Array<{ id: string; at: string; nodeIds: string[] }>;
}

const FILE = () => productPath("flashcards.json");

function defaults(): Settings {
	return { retention: 0.9, learningSteps: [1, 10], relearningSteps: [10], dayStart: 4, fuzz: false, chunkBudget: 4000, modelOverride: null };
}

function emptyState(): CardState {
	return { version: 1, revision: 0, settings: defaults(), decks: [], propositions: {}, reviews: [], batches: [] };
}

function load(): CardState {
	if (!existsSync(FILE())) return emptyState();
	const state = JSON.parse(readFileSync(FILE())) as CardState;
	if (state.version !== 1 || !state.propositions || !Array.isArray(state.decks) || !Array.isArray(state.reviews)) {
		throw new Error("Unsupported or invalid Flashcards data. No data was changed.");
	}
	state.settings = { ...defaults(), ...state.settings };
	state.batches ??= [];
	return state;
}

function save(state: CardState): CardState {
	state.revision += 1;
	writeFileSync(FILE(), JSON.stringify(state));
	return state;
}

function view(state: CardState) {
	const now = Date.now();
	const cards = Object.values(state.propositions).flatMap((proposition) => {
		const cue = scheduler.chooseCue(proposition.cues.filter((item) => !item.deleted));
		if (!cue) return [];
		const due = proposition.schedule.state !== 0 && scheduler.isDue(proposition.schedule, now, state.settings.dayStart);
		return [{ propositionId: proposition.id, cueId: cue.id, question: cue.question, answer: cue.answer, due, name: proposition.name }];
	});
	return {
		revision: state.revision,
		settings: state.settings,
		decks: state.decks.map((deck) => ({ ...deck, due: cards.filter((card) => card.due && deck.propositionIds.includes(card.propositionId)).length })),
		cards,
	};
}

export function flashcardsState(): Response {
	return Response.json(view(load()));
}

export function flashcardsWrite(body: { action?: string; name?: string; deckId?: string; question?: string; answer?: string }): Response {
	const state = load();
	if (body.action === "create-deck") {
		const name = body.name?.trim();
		if (!name) return Response.json({ error: "Deck name is required." }, { status: 400 });
		state.decks.push({ id: randomUUID(), name, newLimit: 20, propositionIds: [] });
		return Response.json(view(save(state)));
	}
	if (body.action === "add-card") {
		const deck = state.decks.find((item) => item.id === body.deckId);
		const question = body.question?.trim();
		const answer = body.answer?.trim();
		if (!deck) return Response.json({ error: "Unknown deck." }, { status: 404 });
		if (!question || !answer) return Response.json({ error: "A card needs a question and an answer." }, { status: 400 });
		const cue = { id: randomUUID(), question, answer };
		const proposition: Proposition = {
			id: `manual:${randomUUID()}`,
			origin: "manual",
			name: deck.name,
			statement: "",
			cues: [cue],
			schedule: scheduler.createSchedule(),
			learningCueId: cue.id,
		};
		state.propositions[proposition.id] = proposition;
		deck.propositionIds.push(proposition.id);
		return Response.json(view(save(state)));
	}
	return Response.json({ error: "Unknown flashcard action." }, { status: 400 });
}

/** Grade one existing card. This function never calls a model. */
export function flashcardsReview(body: { propositionId?: string; rating?: number }): Response {
	const state = load();
	const proposition = body.propositionId ? state.propositions[body.propositionId] : undefined;
	if (!proposition) return Response.json({ error: "Unknown card." }, { status: 404 });
	const rating = body.rating;
	if (rating !== 1 && rating !== 2 && rating !== 3 && rating !== 4) {
		return Response.json({ error: "Rating must be 1, 2, 3, or 4." }, { status: 400 });
	}
	const cue = scheduler.chooseCue(proposition.cues.filter((item) => !item.deleted));
	if (!cue) return Response.json({ error: "This card has no question." }, { status: 400 });
	proposition.schedule = scheduler.rate(proposition.schedule, rating, Date.now(), state.settings);
	state.reviews.push({ propositionId: proposition.id, cueId: cue.id, rating, at: new Date().toISOString() });
	return Response.json(view(save(state)));
}

type CardRunner = (instructions: string, prompt: string) => Promise<string>;
let runnerOverride: CardRunner | null = null;

export function setFlashcardRunner(next: CardRunner | null): void {
	runnerOverride = next;
}

async function defaultRunner(instructions: string, prompt: string): Promise<string> {
	const effective = effectiveSettings();
	const spec = resolveConversationSpec(undefined, effective.models.strong);
	if (!spec) throw new Error("No conversation model is selected.");
	const engine: PiEngine = piEngineForSpec(spec, true);
	const stream = engine.streamFn(engine.model, normalizeContext({
		systemPrompt: instructions,
		messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
		tools: [],
	}), { sessionId: randomUUID() });
	let text = "";
	for await (const event of stream) {
		if (event.type === "text_delta" || event.type === "text_end" || event.type === "done" || event.type === "error") {
			const message = (event.type === "done" ? event.message : event.type === "error" ? event.error : event.partial) as AssistantMessage;
			text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
		}
		if (event.type === "error" && event.reason !== "aborted") throw new Error(event.error.errorMessage ?? "The model call failed.");
	}
	return text;
}

function parseGenerated(text: string): Array<{ propositionId: string; cards: Array<{ question: string; answer: string }> }> {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end < start) throw new Error("The model did not return flashcard JSON.");
	const parsed = JSON.parse(text.slice(start, end + 1)) as { propositions?: unknown };
	if (!Array.isArray(parsed.propositions)) throw new Error("The model did not return flashcard JSON.");
	return parsed.propositions.flatMap((row) => {
		if (!row || typeof row !== "object") return [];
		const item = row as { propositionId?: unknown; cards?: unknown };
		if (typeof item.propositionId !== "string" || !Array.isArray(item.cards)) return [];
		const cards = item.cards.flatMap((card) => {
			if (!card || typeof card !== "object") return [];
			const fields = card as { question?: unknown; answer?: unknown };
			if (typeof fields.question !== "string" || typeof fields.answer !== "string") return [];
			const question = fields.question.trim();
			const answer = fields.answer.trim();
			return question && answer ? [{ question, answer }] : [];
		});
		return [{ propositionId: item.propositionId, cards }];
	});
}

function pack(nodes: GraphNode[], budgetTokens: number): GraphNode[][] {
	const limit = Math.max(1, budgetTokens) * 4;
	const chunks: GraphNode[][] = [];
	let current: GraphNode[] = [];
	let size = 0;
	for (const node of nodes) {
		const weight = node.name.length + node.statement.length;
		if (current.length > 0 && size + weight > limit) {
			chunks.push(current);
			current = [];
			size = 0;
		}
		current.push(node);
		size += weight;
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}

export async function flashcardsGenerate(body: { nodeIds?: string[] }): Promise<Response> {
	const ids = body.nodeIds;
	if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string")) {
		return Response.json({ error: "Select at least one graph proposition." }, { status: 400 });
	}
	const wanted = new Set(ids);
	const nodes = stores.graphStore.readNodes().filter((node) => wanted.has(node.id));
	if (nodes.length === 0) return Response.json({ error: "None of those propositions are in the graph." }, { status: 404 });
	const state = load();
	const deck = state.decks.find((item) => item.name === "From the graph") ?? { id: randomUUID(), name: "From the graph", newLimit: 20, propositionIds: [] };
	if (!state.decks.includes(deck)) state.decks.push(deck);
	try {
		for (const chunk of pack(nodes, state.settings.chunkBudget)) {
			const prompt = prompts.graphPromptFor({
				targets: chunk.map((node) => ({ propositionId: node.id, name: node.name, statement: node.statement })),
				propositions: chunk.map((node) => ({ propositionId: node.id, statement: node.statement })),
				chains: [],
				cards: chunk.map((node) => ({
					propositionId: node.id,
					active: (state.propositions[node.id]?.cues ?? []).filter((cue) => !cue.deleted).map(({ question, answer }) => ({ question, answer })),
				})),
			});
			const text = await (runnerOverride ?? defaultRunner)(prompts.graphInstructions, prompt);
			for (const row of parseGenerated(text)) {
				const node = chunk.find((item) => item.id === row.propositionId);
				if (!node) continue;
				const proposition = state.propositions[node.id] ?? {
					id: node.id,
					origin: "graph" as const,
					name: node.name,
					statement: node.statement,
					cues: [],
					schedule: scheduler.createSchedule(),
					learningCueId: null,
				};
				const known = new Set(proposition.cues.map((cue) => cue.question.trim()));
				for (const card of row.cards) {
					if (known.has(card.question)) continue;
					const cue = { id: randomUUID(), question: card.question, answer: card.answer };
					proposition.cues.push(cue);
					proposition.learningCueId ??= cue.id;
					known.add(card.question);
				}
				state.propositions[node.id] = proposition;
				if (!deck.propositionIds.includes(node.id)) deck.propositionIds.push(node.id);
			}
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : "Card generation failed.";
		return Response.json({ error: message }, { status: 502 });
	}
	state.batches.push({ id: randomUUID(), at: new Date().toISOString(), nodeIds: nodes.map((node) => node.id) });
	return Response.json(view(save(state)));
}
