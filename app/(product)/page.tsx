import type { Metadata } from "next";
import { Home } from "@/components/home";
import { MarketingHome } from "@/components/marketing/home";
import { readSettingsRecord, runAsUser, trialStatusFor } from "@/src/server";
import { resolveSettings, slotsConfigured, translate } from "@/src/core";
import { pageLanguage } from "../_lib/language";
import { pageUserId } from "../_lib/user";

// Dynamic: the configured state is server-rendered into the page (the
// setup CTA's truth on the first frame), and every navigation re-reads
// the record (dynamic routes aren't cached client-side). Unsigned
// visitors get the public marketing entry; a session still gets the graph.
export const dynamic = "force-dynamic";

/** Title and description for the public marketing page, or the product home when a session is open. */
export async function generateMetadata(): Promise<Metadata> {
	const userId = await pageUserId();
	if (userId) {
		const language = await pageLanguage();
		return {
			title: "Learning Harness",
			description: translate(language, "nav.meta.description"),
		};
	}
	return {
		title: "Shunkan — a moment of learning",
		description:
			"Shunkan hosts LearnHarness as a Next.js application with accounts, a database, and an AI gateway. AGPL-3.0-only.",
	};
}

/** Public marketing entry when no profile session is open. A session still gets the product home. */
export default async function HomePage() {
	const userId = await pageUserId();
	if (!userId) return <MarketingHome />;
	const trial = trialStatusFor(userId);
	return runAsUser(userId, () => {
		// First-run gate (model-slots wave): chats cannot start until the user
		// has picked all three slots — the dock shows the CTA while the raw
		// record's models section lacks any slot pin.
		const record = readSettingsRecord();
		// GRAPH RENDERING (owner, 2026-10-06): off = the home's main view is
		// the chains view. Resolved through the one core resolver (missing
		// section / absent key → factory default on); re-read per navigation.
		const rendering = resolveSettings(record ?? null).graph.rendering;
		return <Home initialConfigured={slotsConfigured(record?.models)} rendering={rendering} trial={trial.participant ? trial : null} />;
	});
}
