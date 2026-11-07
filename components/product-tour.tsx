"use client";

/**
 * First-run product tour. NextStep.js owns the overlay, card, and routing
 * adapter (App Router). This wrapper starts `firstRun` once, on the home
 * screen, and remembers a finish or skip for that profile.
 *
 * The default card is white and does not set a text color. The app's body
 * color is light, so app/globals.css pins the card text dark enough to read.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NextStep, NextStepProvider, useNextStep } from "nextstepjs";
import type { Tour } from "nextstepjs";
import { useT } from "@/components/i18n";
import {
	FIRST_RUN_TOUR,
	buildFirstRunTour,
	shouldStartFirstRun,
	tourSeenStorageKey,
	visibleFirstRunSteps,
} from "@/components/product-tour-steps";

function markTourSeen(profileId: string): void {
	try {
		localStorage.setItem(tourSeenStorageKey(profileId), "1");
	} catch {
		// Private mode can reject storage. The tour may show again next visit.
	}
}

function tourAlreadySeen(profileId: string): boolean {
	try {
		return localStorage.getItem(tourSeenStorageKey(profileId)) === "1";
	} catch {
		return true;
	}
}

/** True when the target is laid out and not clipped by a closed sidebar. */
function isTourTargetVisible(selector: string): boolean {
	const el = document.querySelector(selector);
	if (!(el instanceof HTMLElement)) return false;
	const rect = el.getBoundingClientRect();
	if (rect.width < 8 || rect.height < 8) return false;
	const sidebar = el.closest("[data-testid='sessions-sidebar']");
	if (sidebar) {
		const side = sidebar.getBoundingClientRect();
		if (side.width < 8 || side.right <= 0 || side.left >= window.innerWidth) return false;
	}
	const visibleW = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
	const visibleH = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
	return visibleW > 8 && visibleH > 8;
}

function selectorsOf(steps: { selector?: string }[]): Set<string> {
	const selectors = new Set<string>();
	for (const step of steps) {
		if (step.selector) selectors.add(step.selector);
	}
	return selectors;
}

function FirstRunStarter({
	tours,
	profileId,
	onReady,
}: {
	tours: Tour[];
	profileId: string;
	onReady: (selectors: ReadonlySet<string>) => void;
}) {
	const pathname = usePathname();
	const toursRef = useRef(tours);
	toursRef.current = tours;

	useEffect(() => {
		if (pathname !== "/") return;
		let cancelled = false;
		let decided = false;
		let timer = 0;
		const attempt = (triesLeft: number) => {
			if (cancelled || decided) return;
			if (tourAlreadySeen(profileId)) return;
			const tour = toursRef.current[0];
			if (!tour || !document.getElementById("tour-composer")) {
				if (triesLeft > 0) timer = window.setTimeout(() => attempt(triesLeft - 1), 100);
				return;
			}
			const steps = visibleFirstRunSteps(tour.steps, isTourTargetVisible);
			if (!shouldStartFirstRun(steps)) {
				if (triesLeft > 0) timer = window.setTimeout(() => attempt(triesLeft - 1), 100);
				return;
			}
			decided = true;
			onReady(selectorsOf(steps));
		};
		// The sidebar opens in an effect and may still be animating open.
		timer = window.setTimeout(() => attempt(8), 300);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [onReady, pathname, profileId]);

	return null;
}

/** Cards follow the current translations. State only remembers which targets were on screen. */
function displayedTours(tours: Tour[], included: ReadonlySet<string> | null): Tour[] {
	if (!included) return tours;
	return tours.map((tour) => ({
		...tour,
		steps: tour.steps.filter((step) => step.selector === undefined || included.has(step.selector)),
	}));
}

function TourShell({ children, tours, profileId }: { children: React.ReactNode; tours: Tour[]; profileId: string }) {
	const { startNextStep } = useNextStep();
	const [included, setIncluded] = useState<ReadonlySet<string> | null>(null);
	const [armed, setArmed] = useState(false);
	const started = useRef(false);
	const steps = useMemo(() => displayedTours(tours, included), [tours, included]);

	const onReady = useCallback((selectors: ReadonlySet<string>) => {
		setIncluded(selectors);
		setArmed(true);
	}, []);

	const remember = useCallback(() => markTourSeen(profileId), [profileId]);

	useEffect(() => {
		if (!armed || started.current) return;
		started.current = true;
		startNextStep(FIRST_RUN_TOUR);
	}, [armed, startNextStep]);

	return (
		<NextStep
			steps={steps}
			shadowRgb="0, 0, 0"
			shadowOpacity="0.72"
			scrollToTop={false}
			disableConsoleLogs
			onComplete={remember}
			onSkip={remember}
		>
			{children}
			<FirstRunStarter tours={tours} profileId={profileId} onReady={onReady} />
		</NextStep>
	);
}

export function ProductTour({ profileId, children }: { profileId: string; children: React.ReactNode }) {
	const t = useT();
	const tours = useMemo(() => buildFirstRunTour(t), [t]);
	return (
		<NextStepProvider>
			<TourShell tours={tours} profileId={profileId}>{children}</TourShell>
		</NextStepProvider>
	);
}
