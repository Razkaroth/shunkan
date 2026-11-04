"use client";
/**
 * THE SELECT SCREEN (multi-user profiles, 2026-10-27): a Netflix-style
 * row of profile circles. Pick one (PIN when it has one) to open it; add
 * a profile while sign-ups are open. With no profiles yet this is the
 * claim: the first profile is the admin and takes over any existing
 * learner records.
 *
 * Every transition into a profile is a full page load, so nothing from a
 * previous profile's view survives into the next.
 *
 * The language picker at the bottom switches this screen only; a profile
 * created here starts in the picked language.
 */

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { APP_LANGUAGES, isAppLanguage, type PublicProfile, type UsersSnapshot } from "@/src/core";
import { useLanguage, useSetLanguage, useT, type Translate } from "@/components/i18n";
import { ThinSelect } from "@/components/settings/controls";
import { ProfileAvatar } from "./profile-avatar";
import { ProfileForm, type ProfileFormValues } from "./profile-form";
import { TrialRedeem } from "./trial-flow";

type Mode = { kind: "pick" } | { kind: "pin"; profile: PublicProfile } | { kind: "create" } | { kind: "trial" };

async function errorOf(res: Response, t: Translate): Promise<string> {
	const body = (await res.json().catch(() => ({}))) as { error?: string };
	return body.error ?? t("users.error.generic", { status: res.status });
}

function enterApp() {
	window.location.assign("/");
}

export function UserSelect({ snapshot, trialOpen = false }: { snapshot: UsersSnapshot; trialOpen?: boolean }) {
	const t = useT();
	const language = useLanguage();
	const claiming = snapshot.profiles.length === 0;
	const [mode, setMode] = useState<Mode>(claiming ? { kind: "create" } : { kind: "pick" });
	const [notice, setNotice] = useState<string | null>(null);

	const open = async (profile: PublicProfile, pin?: string) => {
		const res = await fetch("/api/users/session", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: profile.id, ...(pin !== undefined ? { pin } : {}) }),
		});
		if (res.ok) return enterApp();
		setNotice(res.status === 401 ? t("users.select.wrongPin", { name: profile.name }) : await errorOf(res, t));
		setMode({ kind: "pick" });
	};

	const create = async (values: ProfileFormValues): Promise<string | null> => {
		const res = await fetch("/api/users", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: values.name, color: values.color, pin: values.pin ?? undefined, language }),
		});
		if (!res.ok) return errorOf(res, t);
		enterApp();
		return null;
	};

	return (
		<main
			data-testid="user-select"
			className="relative flex min-h-dvh flex-col items-center justify-center gap-10 bg-background px-6 pt-12 pb-20 text-foreground"
		>
			{mode.kind === "pick" && (
				<>
					<h1 className="font-title text-4xl tracking-tight">{t("users.select.title")}</h1>
					{notice && (
						<p role="alert" data-testid="user-select-notice" className="-mt-6 text-sm text-red-400">
							{notice}
						</p>
					)}
					<ul className="flex max-w-4xl flex-wrap items-start justify-center gap-8">
						{snapshot.profiles.map((p) => (
							<li key={p.id}>
								<button
									type="button"
									data-testid={`profile-${p.id}`}
									onClick={() => {
										setNotice(null);
										if (p.hasPin) setMode({ kind: "pin", profile: p });
										else void open(p);
									}}
									className="group flex w-32 flex-col items-center gap-3 outline-none"
								>
									<ProfileAvatar
										name={p.name}
										color={p.color}
										className="size-28 text-4xl ring-foreground ring-offset-4 ring-offset-background transition-transform group-hover:scale-105 group-hover:ring-2 group-focus-visible:ring-2"
									/>
									<span className="max-w-full truncate font-prose text-(length:--lh-prose-size) text-muted-foreground transition-colors group-hover:text-foreground">
										{p.name}
									</span>
								</button>
							</li>
						))}
						{snapshot.canSignUp && (
							<li>
								<button
									type="button"
									data-testid="profile-add"
									onClick={() => {
										setNotice(null);
										setMode({ kind: "create" });
									}}
									className="group flex w-32 flex-col items-center gap-3 outline-none"
								>
									<span className="flex size-28 items-center justify-center rounded-full border-2 border-dashed border-border text-muted-foreground transition-colors group-hover:border-muted-foreground group-hover:text-foreground">
										<PlusIcon className="size-10" />
									</span>
									<span className="font-prose text-(length:--lh-prose-size) text-muted-foreground transition-colors group-hover:text-foreground">
										{t("users.select.add")}
									</span>
								</button>
							</li>
						)}
					</ul>
					{trialOpen && (
						<button type="button" className="text-sm text-muted-foreground underline" data-testid="trial-have-code" onClick={() => setMode({ kind: "trial" })}>
							{t("users.trial.haveCode")}
						</button>
					)}
				</>
			)}

			{mode.kind === "pin" && (
				<PinEntry profile={mode.profile} onSubmit={(pin) => void open(mode.profile, pin)} onCancel={() => setMode({ kind: "pick" })} />
			)}

			{mode.kind === "create" && (
				<div className="flex w-full max-w-sm flex-col items-center gap-8">
					<div className="flex flex-col items-center gap-2 text-center">
						<h1 className="font-title text-4xl tracking-tight">{claiming ? t("users.select.welcome") : t("users.select.add")}</h1>
						{claiming && (
							<p className="text-sm text-muted-foreground" data-testid="claim-note">
								{t("users.select.claimNote")}
								{snapshot.existingData && ` ${t("users.select.claimNoteData")}`}
							</p>
						)}
					</div>
					<ProfileForm
						submitLabel={claiming ? t("users.select.create") : t("users.select.add")}
						onSubmit={create}
						onCancel={claiming ? undefined : () => setMode({ kind: "pick" })}
					/>
					{trialOpen && (
						<button type="button" className="text-sm text-muted-foreground underline" data-testid="trial-have-code" onClick={() => setMode({ kind: "trial" })}>
							{t("users.trial.haveCode")}
						</button>
					)}
				</div>
			)}

			{mode.kind === "trial" && (
				<TrialRedeem language={language} onCancel={claiming ? () => setMode({ kind: "create" }) : () => setMode({ kind: "pick" })} />
			)}

			<LanguagePicker />
		</main>
	);
}

function LanguagePicker() {
	const t = useT();
	const language = useLanguage();
	const setLanguage = useSetLanguage();
	return (
		<div className="absolute bottom-6 left-1/2 -translate-x-1/2">
			<ThinSelect
				value={language}
				ariaLabel={t("users.select.language")}
				testid="user-select-language"
				onChange={(next) => {
					if (isAppLanguage(next)) setLanguage(next);
				}}
			>
				{APP_LANGUAGES.map((lang) => (
					<option key={lang.id} value={lang.id}>
						{lang.label}
					</option>
				))}
			</ThinSelect>
		</div>
	);
}

function PinEntry({
	profile,
	onSubmit,
	onCancel,
}: {
	profile: PublicProfile;
	onSubmit: (pin: string) => void;
	onCancel: () => void;
}) {
	const t = useT();
	const [pin, setPin] = useState("");
	return (
		<form
			data-testid="pin-entry"
			className="flex flex-col items-center gap-6"
			onSubmit={(e) => {
				e.preventDefault();
				if (pin) onSubmit(pin);
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					onCancel();
				}
			}}
		>
			<ProfileAvatar name={profile.name} color={profile.color} className="size-28 text-4xl" />
			<div className="flex flex-col items-center gap-1">
				<h1 className="font-title text-3xl tracking-tight">{profile.name}</h1>
				<p className="text-sm text-muted-foreground">{t("users.pin.prompt")}</p>
			</div>
			<input
				autoFocus
				type="password"
				inputMode="numeric"
				autoComplete="off"
				aria-label={t("users.pin.aria")}
				value={pin}
				maxLength={8}
				onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
				data-testid="pin-input"
				className="h-11 w-48 rounded-md border border-border bg-background px-3 text-center font-ui text-xl tracking-[0.5em] text-foreground outline-none focus:border-muted-foreground"
			/>
			<div className="flex gap-2">
				<button
					type="button"
					onClick={onCancel}
					className="h-8 rounded-md px-4 font-ui text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					{t("users.pin.back")}
				</button>
				<button
					type="submit"
					disabled={!pin}
					data-testid="pin-submit"
					className="h-8 rounded-md bg-primary px-4 font-ui text-xs uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
				>
					{t("users.pin.open")}
				</button>
			</div>
		</form>
	);
}
