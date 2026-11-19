"use client";

import { useState, type FormEvent } from "react";
import { useT } from "@/components/i18n";

export function LoginForm() {
	const t = useT();
	const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function submit(event: FormEvent) {
		event.preventDefault();
		setPending(true);
		setError(null);
		try {
			const res = mode === "sign-in"
				? await fetch("/api/auth/sign-in/email", {
					method: "POST",
					credentials: "include",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ email, password }),
				})
				: await fetch("/api/account/signup", {
					method: "POST",
					credentials: "include",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ email, password }),
				});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
				setError(body.error ?? body.message ?? t("users.login.failed"));
				return;
			}
			window.location.assign("/users");
		} catch {
			setError(t("users.login.failed"));
		} finally {
			setPending(false);
		}
	}

	return (
		<form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
			<h1 className="font-ui text-sm uppercase tracking-wider text-foreground">{t("users.login.title")}</h1>
			<label className="flex flex-col gap-1 font-ui text-xs text-muted-foreground">
				{t("users.login.email")}
				<input
					type="email"
					required
					autoComplete="email"
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					className="h-8 rounded-sm border border-border bg-background px-2 text-foreground"
				/>
			</label>
			<label className="flex flex-col gap-1 font-ui text-xs text-muted-foreground">
				{t("users.login.password")}
				<input
					type="password"
					required
					autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					className="h-8 rounded-sm border border-border bg-background px-2 text-foreground"
				/>
			</label>
			{error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
			<button type="submit" disabled={pending} className="h-8 rounded-sm bg-foreground font-ui text-xs text-background disabled:opacity-40">
				{pending ? t("users.login.working") : mode === "sign-in" ? t("users.login.signIn") : t("users.login.signUp")}
			</button>
			<button
				type="button"
				className="self-start font-ui text-xs text-muted-foreground underline"
				onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setError(null); }}
			>
				{mode === "sign-in" ? t("users.login.switchSignUp") : t("users.login.switchSignIn")}
			</button>
		</form>
	);
}
