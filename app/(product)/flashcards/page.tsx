"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/i18n";

interface Card { propositionId: string; question: string; answer: string; due: boolean; name: string }
interface Deck { id: string; name: string }
interface Node { id: string; name: string }

export default function FlashcardsPage() {
	const t = useT();
	const [decks, setDecks] = useState<Deck[]>([]);
	const [cards, setCards] = useState<Card[]>([]);
	const [nodes, setNodes] = useState<Node[]>([]);
	const [selected, setSelected] = useState<string[]>([]);
	const [deckName, setDeckName] = useState("");
	const [deckId, setDeckId] = useState("");
	const [question, setQuestion] = useState("");
	const [answer, setAnswer] = useState("");
	const [revealed, setRevealed] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const due = cards.find((card) => card.due) ?? cards[0];

	const reload = () => {
		void fetch("/api/flashcards").then((response) => response.json()).then((body: { decks?: Deck[]; cards?: Card[]; error?: string }) => {
			setDecks(body.decks ?? []);
			setCards(body.cards ?? []);
			if (body.error) setError(body.error);
		}).catch(() => setError(t("chat.session.genericError")));
	};
	useEffect(() => {
		reload();
		void fetch("/api/graph").then((response) => response.json()).then((body: { nodes?: Node[] }) => setNodes(body.nodes ?? [])).catch(() => undefined);
	}, []);

	const post = async (body: unknown) => {
		setError(null);
		const response = await fetch("/api/flashcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
		const payload = await response.json() as { decks?: Deck[]; cards?: Card[]; error?: string };
		if (!response.ok) { setError(payload.error ?? t("chat.session.genericError")); return; }
		setDecks(payload.decks ?? []);
		setCards(payload.cards ?? []);
		setRevealed(false);
	};

	return (
		<main className="mx-auto flex max-w-xl flex-col gap-4 p-6">
			<h1 className="font-title text-2xl">{t("chat.flashcards.title")}</h1>
			{error ? <p className="text-sm text-destructive">{error}</p> : null}
			<form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void post({ action: "create-deck", name: deckName }); setDeckName(""); }}>
				<input value={deckName} onChange={(event) => setDeckName(event.target.value)} placeholder={t("chat.flashcards.deckName")} className="flex-1 rounded-sm border border-border bg-background px-2 py-1 text-sm" />
				<button type="submit" className="rounded-sm border border-border px-2 py-1 text-sm">{t("chat.flashcards.createDeck")}</button>
			</form>
			<form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void post({ action: "add-card", deckId, question, answer }); setQuestion(""); setAnswer(""); }}>
				<select value={deckId} onChange={(event) => setDeckId(event.target.value)} className="rounded-sm border border-border bg-background px-2 py-1 text-sm">
					<option value="">{t("chat.flashcards.deckName")}</option>
					{decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
				</select>
				<input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={t("chat.flashcards.question")} className="rounded-sm border border-border bg-background px-2 py-1 text-sm" />
				<input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder={t("chat.flashcards.answer")} className="rounded-sm border border-border bg-background px-2 py-1 text-sm" />
				<button type="submit" className="self-start rounded-sm border border-border px-2 py-1 text-sm">{t("chat.flashcards.add")}</button>
			</form>
			<section className="rounded-md border border-border p-3">
				{due ? (
					<>
						<p>{due.question}</p>
						{revealed ? <p className="mt-2 text-muted-foreground">{due.answer}</p> : (
							<button type="button" className="mt-2 text-sm" onClick={() => setRevealed(true)}>{t("chat.flashcards.showAnswer")}</button>
						)}
						<div className="mt-3 flex flex-wrap gap-2">
							{[1, 2, 3, 4].map((rating) => (
								<button key={rating} type="button" className="rounded-sm border border-border px-2 py-1 text-xs" onClick={() => void post({ action: "review", propositionId: due.propositionId, rating })}>
									{t(rating === 1 ? "chat.flashcards.again" : rating === 2 ? "chat.flashcards.hard" : rating === 3 ? "chat.flashcards.good" : "chat.flashcards.easy")}
								</button>
							))}
						</div>
					</>
				) : <p className="text-sm text-muted-foreground">{t("chat.flashcards.empty")}</p>}
			</section>
			<section className="flex flex-col gap-2">
				{nodes.slice(0, 40).map((node) => (
					<label key={node.id} className="flex items-center gap-2 text-sm">
						<input type="checkbox" checked={selected.includes(node.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, node.id] : current.filter((id) => id !== node.id))} />
						{node.name}
					</label>
				))}
				<button type="button" className="self-start rounded-sm border border-border px-2 py-1 text-sm" onClick={() => void post({ action: "generate", nodeIds: selected })}>{t("chat.flashcards.generate")}</button>
			</section>
		</main>
	);
}
