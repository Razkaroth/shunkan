"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/i18n";
import { useDictationTarget } from "@/components/dictation";
import type { SideChatThread } from "@/src/core";

export interface SideAskAnchor {
	messageId: string;
	partId: string;
	blockIndex: number;
	blockText: string;
}

/** One helper thread for a teaching segment. Dictation reuses the composer microphone. */
export function SideThreadPanel({ chatId, anchor, onClose }: { chatId: string; anchor: SideAskAnchor; onClose: () => void }) {
	const t = useT();
	const [thread, setThread] = useState<SideChatThread | null>(null);
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	useDictationTarget((spoken) => setText((current) => current ? `${current} ${spoken}` : spoken), true);

	useEffect(() => {
		if (!thread?.runId && !thread?.messages.some((message) => message.pending)) return;
		const timer = setInterval(() => {
			void fetch(`/api/chats/${chatId}/side`).then((response) => response.json()).then((body: { threads?: SideChatThread[] }) => {
				const next = body.threads?.find((item) => item.id === thread.id);
				if (next) setThread(next);
			}).catch(() => undefined);
		}, 1000);
		return () => clearInterval(timer);
	}, [chatId, thread]);

	const ask = async () => {
		const question = text.trim();
		if (!question || busy) return;
		setBusy(true);
		setError(null);
		try {
			const response = await fetch(`/api/chats/${chatId}/side`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(thread ? { threadId: thread.id, text: question, quotes: [] } : { anchor, text: question, quotes: [anchor.blockText] }),
			});
			const body = await response.json() as { thread?: SideChatThread; error?: string };
			if (!response.ok || !body.thread) { setError(body.error ?? t("chat.session.genericError")); return; }
			setThread(body.thread);
			setText("");
		} finally {
			setBusy(false);
		}
	};

	return (
		<aside className="absolute right-3 bottom-24 z-30 w-80 max-w-[calc(100%-1.5rem)] rounded-md border border-border bg-popover p-3 shadow-md" data-testid="side-thread">
			<div className="mb-2 flex items-center justify-between gap-2">
				<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("chat.side.title")}</div>
				<button type="button" className="text-xs text-muted-foreground" onClick={onClose}>{t("chat.side.close")}</button>
			</div>
			<div className="max-h-64 space-y-2 overflow-auto text-sm">
				{thread?.messages.map((message) => (
					<p key={message.id} className={message.role === "user" ? "text-foreground" : "text-muted-foreground"}>
						{message.text}
						{message.error ? ` (${message.error})` : ""}
					</p>
				))}
			</div>
			<textarea
				value={text}
				onChange={(event) => setText(event.target.value)}
				placeholder={t("chat.side.placeholder")}
				className="mt-2 h-20 w-full resize-none rounded-sm border border-border bg-background p-2 text-sm"
			/>
			{error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
			<div className="mt-2 flex gap-2">
				<button type="button" className="rounded-sm border border-border px-2 py-1 text-xs" onClick={() => void ask()}>{t("chat.side.send")}</button>
				{thread ? (
					<button
						type="button"
						className="rounded-sm border border-border px-2 py-1 text-xs"
						onClick={() => void fetch(`/api/chats/${chatId}/side`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stop: true, threadId: thread.id }) })}
					>
						{t("chat.side.stop")}
					</button>
				) : null}
			</div>
		</aside>
	);
}
