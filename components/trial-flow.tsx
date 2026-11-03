"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { TrialPublicStatus } from "@/src/core";
import { useT } from "@/components/i18n";
import { ProfileForm, type ProfileFormValues } from "./profile-form";

async function errorOf(res: Response): Promise<string> {
	const body = (await res.json().catch(() => ({}))) as { error?: string };
	return body.error ?? "Something went wrong.";
}

export function TrialRedeem({
	language,
	onCancel,
}: {
	language: string;
	onCancel?: () => void;
}) {
	const t = useT();
	const [code, setCode] = useState("");
	const redeem = async (values: ProfileFormValues): Promise<string | null> => {
		const res = await fetch("/api/trial/redeem", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				code,
				name: values.name,
				color: values.color,
				pin: values.pin ?? undefined,
				language,
			}),
		});
		if (!res.ok) return errorOf(res);
		window.location.assign("/");
		return null;
	};
	return (
		<div className="flex w-full max-w-sm flex-col items-center gap-6" data-testid="trial-redeem">
			<div className="flex flex-col items-center gap-2 text-center">
				<h1 className="font-title text-4xl tracking-tight">{t("users.trial.title")}</h1>
				<p className="text-sm text-muted-foreground">{t("users.trial.note")}</p>
			</div>
			<label className="flex w-full flex-col gap-1 text-sm">
				<span>{t("users.trial.code")}</span>
				<input
					autoFocus
					value={code}
					autoComplete="off"
					placeholder={t("users.trial.code.placeholder")}
					onChange={(e) => setCode(e.target.value)}
					data-testid="trial-code"
					className="h-11 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-muted-foreground"
				/>
			</label>
			<ProfileForm submitLabel={t("users.trial.redeem")} onSubmit={redeem} onCancel={onCancel} />
		</div>
	);
}

export function TrialHomeOffer({ status }: { status: TrialPublicStatus }) {
	const t = useT();
	const [error, setError] = useState<string | null>(null);
	if (!status.participant || status.signupRequired) return null;
	const start = async () => {
		const res = await fetch("/api/trial/sol", { method: "POST" });
		if (!res.ok) {
			setError(await errorOf(res));
			return;
		}
		const body = (await res.json()) as { chatId?: string };
		if (body.chatId) window.location.assign(`/chat/${body.chatId}`);
	};
	return (
		<div className="flex max-w-xl flex-col gap-1 rounded-md border border-border bg-card/90 px-3 py-2 text-sm" data-testid="trial-offer">
			<p className="text-muted-foreground">{t("users.trial.note")}</p>
			{status.solOpen && status.solChatId ? (
				<a className="font-medium underline" href={`/chat/${status.solChatId}`} data-testid="trial-sol-open">
					{t("users.trial.sol.open")}
				</a>
			) : status.signedUp ? null : (
				<button type="button" className="w-fit font-medium underline" onClick={() => void start()} data-testid="trial-sol-start">
					{t("users.trial.sol.start")}
				</button>
			)}
			{error && <p role="alert">{error}</p>}
		</div>
	);
}

/** Watches the open GPT-Sol chat and leaves for signup when the reply ends it. */
export function TrialSolBar() {
	const t = useT();
	useEffect(() => {
		let stopped = false;
		const tick = async () => {
			const res = await fetch("/api/trial", { cache: "no-store" });
			if (!res.ok || stopped) return;
			const body = (await res.json()) as TrialPublicStatus;
			if (body.signupRequired) window.location.assign("/");
		};
		const timer = setInterval(() => void tick(), 2000);
		return () => {
			stopped = true;
			clearInterval(timer);
		};
	}, []);
	const end = async () => {
		await fetch("/api/trial/sol/end", { method: "POST" });
		window.location.assign("/");
	};
	return (
		<div className="pointer-events-auto absolute inset-x-0 top-14 z-20 mx-auto flex w-full max-w-xl items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm" data-testid="trial-sol-bar">
			<p className="text-muted-foreground">{t("users.trial.sol.waiting")}</p>
			<button type="button" className="shrink-0 font-medium underline" onClick={() => void end()} data-testid="trial-sol-end">
				{t("users.trial.sol.end")}
			</button>
		</div>
	);
}

export function TrialSignup() {
	const t = useT();
	const [email, setEmail] = useState("");
	const [name, setName] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError(null);
		const res = await fetch("/api/trial/signup", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, name, password }),
		});
		setBusy(false);
		if (!res.ok) {
			setError(await errorOf(res));
			return;
		}
		window.location.assign("/");
	};
	return (
		<main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground" data-testid="trial-signup">
			<form onSubmit={(event) => void submit(event)} className="flex w-full max-w-sm flex-col gap-4">
				<h1 className="font-title text-4xl tracking-tight">{t("users.trial.signup.title")}</h1>
				<p className="text-sm text-muted-foreground">{t("users.trial.signup.body")}</p>
				{error && <p role="alert" className="text-sm text-red-400">{error}</p>}
				<label className="flex flex-col gap-1 text-sm">
					<span>{t("users.trial.signup.name")}</span>
					<input required value={name} onChange={(e) => setName(e.target.value)} className="h-11 rounded-md border border-border bg-background px-3 outline-none" data-testid="trial-signup-name" />
				</label>
				<label className="flex flex-col gap-1 text-sm">
					<span>{t("users.trial.signup.email")}</span>
					<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-md border border-border bg-background px-3 outline-none" data-testid="trial-signup-email" />
				</label>
				<label className="flex flex-col gap-1 text-sm">
					<span>{t("users.trial.signup.password")}</span>
					<input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 rounded-md border border-border bg-background px-3 outline-none" data-testid="trial-signup-password" />
				</label>
				<button type="submit" disabled={busy} className="h-11 rounded-md bg-foreground text-background" data-testid="trial-signup-submit">
					{t("users.trial.signup.submit")}
				</button>
			</form>
		</main>
	);
}
