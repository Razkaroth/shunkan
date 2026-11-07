/**
 * Mounts the tour and the home/sidebar shells. NextStep and the App Router
 * are replaced so the test can see startNextStep and the rendered anchors
 * without a browser.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import type { Tour } from "nextstepjs";

const harness: {
	pathname: string;
	starts: string[];
	steps: Tour[];
	onComplete?: () => void;
	onSkip?: () => void;
} = { pathname: "/", starts: [], steps: [] };

// Node's runtime option is `exports`. The published MockModuleOptions type still says `namedExports`.
const moduleExports = (exports: Record<string, unknown>) => ({ exports }) as Parameters<typeof mock.module>[1];

mock.module("next/navigation", moduleExports({
	usePathname: () => harness.pathname,
	useRouter: () => ({ push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}));

mock.module("nextstepjs", moduleExports({
		NextStepProvider: ({ children }: { children: React.ReactNode }) => children,
		NextStep: ({
			steps,
			children,
			onComplete,
			onSkip,
		}: {
			steps: Tour[];
			children: React.ReactNode;
			onComplete?: () => void;
			onSkip?: () => void;
		}) => {
			harness.steps = steps;
			harness.onComplete = onComplete;
			harness.onSkip = onSkip;
			return children;
		},
		useNextStep: () => ({
			startNextStep: (name: string) => {
				harness.starts.push(name);
			},
		}),
}));

const dom = parseHTML("<html><body></body></html>");
const box = { x: 8, y: 8, top: 8, left: 8, right: 120, bottom: 48, width: 112, height: 40, toJSON() { return {}; } };
const empty = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() { return {}; } };
dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
	return this.id.startsWith("tour-") ? box : empty;
};
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

class MemoryStorage {
	private data = new Map<string, string>();
	get length() { return this.data.size; }
	key() { return null; }
	getItem(key: string) { return this.data.get(key) ?? null; }
	setItem(key: string, value: string) { this.data.set(key, String(value)); }
	removeItem(key: string) { this.data.delete(key); }
	clear() { this.data.clear(); }
}
Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });

const { ProductTour } = await import("../components/product-tour.tsx");
const { Home } = await import("../components/home.tsx");
const { AppShell } = await import("../components/sidebar.tsx");
const { ServerEventsProvider } = await import("../components/server-events.tsx");
const { I18nProvider, useSetLanguage } = await import("../components/i18n.tsx");
const { FIRST_RUN_TOUR, tourSeenStorageKey } = await import("../components/product-tour-steps.ts");

const quietEvents = () => ({ close() {}, onOpen() {}, onEvent() {} });

function ToSpanish() {
	const setLanguage = useSetLanguage();
	return <button type="button" id="to-es" onClick={() => setLanguage("es")}>es</button>;
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount(node: React.ReactNode) {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	await act(async () => { root!.render(node); });
}

async function settle(ms: number) {
	await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

afterEach(async () => {
	await act(async () => { root?.unmount(); });
	host?.remove();
	root = undefined;
	host = undefined;
	harness.pathname = "/";
	harness.starts = [];
	harness.steps = [];
	harness.onComplete = undefined;
	harness.onSkip = undefined;
	localStorage.clear();
});

describe("first-run tour startup", () => {
	it("starts once on the home route when the composer is on screen", async () => {
		await mount(
			<I18nProvider initialLanguage="en">
				<ProductTour profileId="ada">
					<div id="tour-composer" />
					<ToSpanish />
				</ProductTour>
			</I18nProvider>,
		);
		await settle(400);
		assert.deepEqual(harness.starts, [FIRST_RUN_TOUR]);
		assert.equal(harness.steps[0]?.steps[0]?.title, "Welcome");
		assert.ok(harness.steps[0]?.steps.some((step) => step.selector === "#tour-composer"));

		await act(async () => { document.getElementById("to-es")!.click(); });
		assert.deepEqual(harness.starts, [FIRST_RUN_TOUR]);
		assert.equal(harness.steps[0]?.steps[0]?.title, "Empieza aquí");
		assert.equal(
			harness.steps[0]?.steps.find((step) => step.selector === "#tour-composer")?.title,
			"Empieza una lección",
		);

		harness.onComplete?.();
		assert.equal(localStorage.getItem(tourSeenStorageKey("ada")), "1");
		assert.equal(localStorage.getItem(tourSeenStorageKey("grace")), null);
	});

	it("does not start for a profile that already finished, and still starts for another", async () => {
		localStorage.setItem(tourSeenStorageKey("ada"), "1");
		await mount(<ProductTour profileId="ada"><div id="tour-composer" /></ProductTour>);
		await settle(400);
		assert.deepEqual(harness.starts, []);

		await act(async () => { root?.unmount(); });
		host?.remove();
		harness.starts = [];
		await mount(<ProductTour profileId="grace"><div id="tour-composer" /></ProductTour>);
		await settle(400);
		assert.deepEqual(harness.starts, [FIRST_RUN_TOUR]);
	});

	it("does not start when the home composer is absent", async () => {
		await mount(<ProductTour profileId="ada"><div id="somewhere-else" /></ProductTour>);
		await settle(1300);
		assert.deepEqual(harness.starts, []);
	});

	it("renders the home and sidebar anchors", () => {
		const home = renderToStaticMarkup(
			<ServerEventsProvider connect={quietEvents}>
				<Home initialConfigured rendering={false} />
			</ServerEventsProvider>,
		);
		assert.ok(home.includes('id="tour-composer"'));
		assert.ok(home.includes('id="tour-mode"'));
		assert.ok(home.includes('id="tour-chains"'));
		assert.ok(home.includes('id="tour-import"'));
		const sidebar = renderToStaticMarkup(
			<ServerEventsProvider connect={quietEvents}>
				<AppShell><div /></AppShell>
			</ServerEventsProvider>,
		);
		assert.ok(sidebar.includes('id="tour-new-sessions"'));
		assert.ok(sidebar.includes('id="tour-session-list"'));
		assert.ok(sidebar.includes('id="tour-settings"'));
	});
});
