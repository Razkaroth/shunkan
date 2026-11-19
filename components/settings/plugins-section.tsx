"use client";

import { useEffect, useState } from "react";
import { PLUGINS_CHANGED_EVENT, PLUGIN_IDS, type PluginFlags, type PluginId } from "@/src/core";
import { useT } from "@/components/i18n";
import { SettingsRow, Toggle } from "./controls.tsx";

const EMPTY: PluginFlags = { flashcards: false, drawingPad: false, richCodeBlocks: false };

const LABEL = {
	flashcards: "settings.plugins.flashcards",
	drawingPad: "settings.plugins.drawingPad",
	richCodeBlocks: "settings.plugins.richCodeBlocks",
} as const;

export function PluginsSection() {
	const t = useT();
	const [allowed, setAllowed] = useState<PluginFlags>(EMPTY);
	const [enabled, setEnabled] = useState<PluginFlags>(EMPTY);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const res = await fetch("/api/plugins", { cache: "no-store" });
				const body = (await res.json().catch(() => ({}))) as { allowed?: PluginFlags; enabled?: PluginFlags };
				if (cancelled || !res.ok || !body.allowed || !body.enabled) return;
				setAllowed(body.allowed);
				setEnabled(body.enabled);
			} catch {
				if (!cancelled) setError(t("settings.plugins.failed"));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [t]);

	async function toggle(id: PluginId, next: boolean) {
		if (pending) return;
		setPending(true);
		setError(null);
		try {
			const res = await fetch("/api/plugins", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ plugin: id, enabled: next }),
			});
			const body = (await res.json().catch(() => ({}))) as { enabled?: PluginFlags; error?: string };
			if (!res.ok || !body.enabled) {
				setError(body.error ?? t("settings.plugins.failed"));
				return;
			}
			setEnabled(body.enabled);
			window.dispatchEvent(new CustomEvent(PLUGINS_CHANGED_EVENT, { detail: body.enabled }));
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="flex flex-col gap-2">
			{error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
			{PLUGIN_IDS.map((id) => (
				<SettingsRow key={id} label={t(LABEL[id])} hint={allowed[id] ? undefined : t("settings.plugins.unavailable")}>
					<Toggle
						checked={enabled[id]}
						disabled={!allowed[id] || pending}
						onChange={(next) => void toggle(id, next)}
						label={t(LABEL[id])}
						testid={`plugin-${id}`}
					/>
				</SettingsRow>
			))}
		</div>
	);
}
