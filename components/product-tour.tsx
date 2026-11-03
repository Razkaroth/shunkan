"use client";

/**
 * First-run product tour. NextStep.js owns the overlay, card, and routing
 * adapter (App Router). This wrapper starts `firstRun` once, on the home
 * screen, and remembers a finish or skip in localStorage.
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
	FIRST_RUN_TOUR_SEEN_KEY,
	buildFirstRunTour,
	shouldStartFirstRun,
	visibleFirstRunSteps,
} from "@/components/product-tour-steps";

function markTourSeen(): void {
	try {
		localStorage.setItem(FIRST_RUN_TOUR_SEEN_KEY, "1");
	} catch {
		// Private mode can reject storage. The tour may show again next visit.
	}
}

function tourAlreadySeen(): boolean {
	try {
		return localStorage.getItem(FIRST_RUN_TOUR_SEEN_KEY) === "1";
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

function FirstRunStarter({ tours, onReady }: { tours: Tour[]; onReady: (tours: Tour[]) => void }) {
	const pathname = usePathname();
	const decided = useRef(false);

	useEffect(() => {
		if (pathname !== "/" || decided.current) return;
		let cancelled = false;
		let timer = 0;
		const attempt = (triesLeft: number) => {
			if (cancelled || decided.current) return;
			if (tourAlreadySeen()) return;
			const tour = tours[0];
			if (!tour || !document.getElementById("tour-composer")) {
				if (triesLeft > 0) timer = window.setTimeout(() => attempt(triesLeft - 1), 100);
				return;
			}
			const steps = visibleFirstRunSteps(tour.steps, isTourTargetVisible);
			if (!shouldStartFirstRun(steps)) {
				if (triesLeft > 0) timer = window.setTimeout(() => attempt(triesLeft - 1), 100);
				return;
			}
			decided.current = true;
			onReady([{ tour: tour.tour, steps }]);
		};
		// The sidebar opens in an effect and may still be animating open.
		timer = window.setTimeout(() => attempt(8), 300);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [onReady, pathname, tours]);

	return null;
}

function TourShell({ children, tours }: { children: React.ReactNode; tours: Tour[] }) {
	const { startNextStep } = useNextStep();
	const [steps, setSteps] = useState(tours);
	const [armed, setArmed] = useState(false);
	const started = useRef(false);

	const onReady = useCallback((next: Tour[]) => {
		setSteps(next);
		setArmed(true);
	}, []);

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
			onComplete={markTourSeen}
			onSkip={markTourSeen}
		>
			{children}
			<FirstRunStarter tours={tours} onReady={onReady} />
		</NextStep>
	);
}

export function ProductTour({ children }: { children: React.ReactNode }) {
	const t = useT();
	const tours = useMemo(() => buildFirstRunTour(t), [t]);
	return (
		<NextStepProvider>
			<TourShell tours={tours}>{children}</TourShell>
		</NextStepProvider>
	);
}
