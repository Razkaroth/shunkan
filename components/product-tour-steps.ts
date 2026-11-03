/**
 * First-run tour steps for NextStep.js. Selectors are element ids on
 * surfaces that exist before any session: the home composer, the
 * teach/practice switch, chains, note import, and the session sidebar.
 * Session transcripts, the setup dialog, and empty-graph-only chrome
 * are omitted — those nodes are not on screen for a new learner.
 */
import type { Step, Tour } from "nextstepjs";
import type { TranslationKey } from "@/src/core";

export const FIRST_RUN_TOUR = "firstRun";

/** localStorage flag set when the learner finishes or skips the tour. */
export const FIRST_RUN_TOUR_SEEN_KEY = "lh:product-tour-seen";

export type TourCopy = (key: TranslationKey) => string;

const targeted = (
	copy: TourCopy,
	title: TranslationKey,
	body: TranslationKey,
	selector: string,
	side: NonNullable<Step["side"]>,
	icon: string,
): Step => ({
	icon,
	title: copy(title),
	content: copy(body),
	selector,
	side,
	showControls: true,
	showSkip: true,
	// The app already owns arrow keys and Escape. Buttons drive the tour.
	blockKeyboardControl: true,
	disableInteraction: true,
	pointerPadding: 8,
	pointerRadius: 12,
	selectorRetryAttempts: 8,
	selectorRetryDelay: 100,
});

export function buildFirstRunTour(copy: TourCopy): Tour[] {
	return [
		{
			tour: FIRST_RUN_TOUR,
			steps: [
				{
					icon: "👋",
					title: copy("tour.welcome.title"),
					content: copy("tour.welcome.body"),
					showControls: true,
					showSkip: true,
					blockKeyboardControl: true,
				},
				targeted(copy, "tour.composer.title", "tour.composer.body", "#tour-composer", "top", "✏️"),
				targeted(copy, "tour.mode.title", "tour.mode.body", "#tour-mode", "top", "🎯"),
				targeted(copy, "tour.chains.title", "tour.chains.body", "#tour-chains", "bottom", "🔗"),
				targeted(copy, "tour.import.title", "tour.import.body", "#tour-import", "bottom", "📄"),
				targeted(copy, "tour.newSessions.title", "tour.newSessions.body", "#tour-new-sessions", "right", "➕"),
				targeted(copy, "tour.sessions.title", "tour.sessions.body", "#tour-session-list", "right", "📚"),
				targeted(copy, "tour.settings.title", "tour.settings.body", "#tour-settings", "right", "⚙️"),
			],
		},
	];
}

/** Drop steps whose target is not actually on screen. The welcome card has no selector. */
export function visibleFirstRunSteps(steps: readonly Step[], isVisible: (selector: string) => boolean): Step[] {
	return steps.filter((step) => step.selector === undefined || isVisible(step.selector));
}

/** The home composer is the anchor. Without it, this is not the first-run home. */
export function shouldStartFirstRun(steps: readonly Step[]): boolean {
	return steps.some((step) => step.selector === "#tour-composer");
}
