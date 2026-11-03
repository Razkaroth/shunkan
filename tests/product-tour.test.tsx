/**
 * First-run tour: the step list stays on surfaces that exist before a
 * session, copy is translated, and hidden targets (a closed sidebar) drop
 * out instead of pointing at nothing.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { translate } from "../src/core/index.ts";
import { GraphChromeRow } from "../components/graph-view.tsx";
import { NotesImportControl } from "../components/notes-import.tsx";
import {
	FIRST_RUN_TOUR,
	buildFirstRunTour,
	shouldStartFirstRun,
	visibleFirstRunSteps,
} from "../components/product-tour-steps.ts";
import type { GraphRenderSettings } from "../components/graph-canvas.ts";

const SELECTORS = [
	"#tour-composer",
	"#tour-mode",
	"#tour-chains",
	"#tour-import",
	"#tour-new-sessions",
	"#tour-session-list",
	"#tour-settings",
] as const;

describe("first-run tour", () => {
	it("names one NextStep tour and targets the home surfaces in order", () => {
		const [tour] = buildFirstRunTour((key) => translate("en", key));
		assert.ok(tour);
		assert.equal(tour.tour, FIRST_RUN_TOUR);
		assert.equal(tour.steps[0]?.title, "Welcome");
		assert.equal(tour.steps[0]?.selector, undefined);
		assert.deepEqual(
			tour.steps.slice(1).map((step) => step.selector),
			SELECTORS,
		);
		for (const step of tour.steps) {
			assert.equal(step.showControls, true);
			assert.equal(step.showSkip, true);
			assert.equal(step.blockKeyboardControl, true);
		}
	});

	it("translates every step into Spanish", () => {
		const en = buildFirstRunTour((key) => translate("en", key))[0]?.steps ?? [];
		const es = buildFirstRunTour((key) => translate("es", key))[0]?.steps ?? [];
		assert.equal(en.length, es.length);
		for (let i = 0; i < en.length; i++) {
			assert.notEqual(es[i]?.title, en[i]?.title);
			assert.notEqual(es[i]?.content, en[i]?.content);
			assert.equal(typeof es[i]?.content, "string");
			assert.ok(String(es[i]?.content).length > 0);
		}
	});

	it("drops targets that are not on screen and will not start without the composer", () => {
		const steps = buildFirstRunTour((key) => translate("en", key))[0]?.steps ?? [];
		const visible = visibleFirstRunSteps(steps, (selector) => selector === "#tour-composer" || selector === "#tour-mode");
		assert.deepEqual(
			visible.map((step) => step.selector ?? "welcome"),
			["welcome", "#tour-composer", "#tour-mode"],
		);
		assert.equal(shouldStartFirstRun(visible), true);
		assert.equal(shouldStartFirstRun(visibleFirstRunSteps(steps, () => false)), false);
	});

	it("renders the chain and import anchors the tour selects", () => {
		const chrome = renderToStaticMarkup(
			createElement(GraphChromeRow, {
				isEmpty: true,
				query: "",
				onQuery: () => {},
				noMatch: false,
				importing: false,
				searchInputRef: { current: null },
				onImportFiles: () => {},
				settings: {} as GraphRenderSettings,
				changeSettings: () => {},
				onOpenChains: () => {},
			}),
		);
		assert.ok(chrome.includes('id="tour-chains"'));
		assert.ok(chrome.includes('id="tour-import"'));
		const notes = renderToStaticMarkup(
			createElement(NotesImportControl, { importing: false, onImportFiles: () => {} }),
		);
		assert.ok(notes.includes('id="tour-import"'));
	});

	it("pins the remaining anchors in the home and sidebar source", () => {
		const home = readFileSync(new URL("../components/home.tsx", import.meta.url), "utf8");
		const sidebar = readFileSync(new URL("../components/sidebar.tsx", import.meta.url), "utf8");
		const minimal = readFileSync(new URL("../components/minimal-home.tsx", import.meta.url), "utf8");
		assert.ok(home.includes('id="tour-composer"'));
		assert.ok(sidebar.includes('id="tour-new-sessions"'));
		assert.ok(sidebar.includes('id="tour-session-list"'));
		assert.ok(sidebar.includes('id="tour-settings"'));
		assert.ok(minimal.includes('id="tour-chains"'));
		assert.ok(home.includes('id="tour-mode"'));
	});
});
