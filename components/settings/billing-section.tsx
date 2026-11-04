"use client";
/**
 * Basic plan and recharge. Checkout is Stripe; balances are read from
 * Stripe. The pay-as-you-go flag is not edited here.
 */
import { useEffect, useState } from "react";
import { useT } from "@/components/i18n";
import { SettingsRow } from "./controls.tsx";

interface BillingStatus {
	configured: boolean;
	payAsYouGo: boolean;
	monthlyCentavos: number;
	rechargeCentavos: number;
}

const ACTION = "rounded-sm px-2 py-1 font-ui text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40";

function mxn(centavos: number): string {
	const whole = Math.floor(Math.abs(centavos) / 100);
	const frac = String(Math.abs(centavos) % 100).padStart(2, "0");
	return `${whole}.${frac} MXN`;
}

export function BillingSection() {
	const t = useT();
	const [status, setStatus] = useState<BillingStatus | null>(null);
	const [amount, setAmount] = useState("150");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const res = await fetch("/api/billing/status");
				const body = (await res.json().catch(() => ({}))) as BillingStatus & { error?: string };
				if (cancelled) return;
				if (!res.ok) {
					setError(body.error ?? t("settings.billing.failed"));
					return;
				}
				setStatus(body);
			} catch {
				if (!cancelled) setError(t("settings.billing.failed"));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [t]);

	async function openCheckout(path: string, body?: unknown) {
		setPending(true);
		setError(null);
		try {
			const res = await fetch(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body ?? {}),
			});
			const payload = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
			if (!res.ok || typeof payload.url !== "string") {
				setError(payload.error ?? t("settings.billing.failed"));
				return;
			}
			window.location.assign(payload.url);
		} catch {
			setError(t("settings.billing.failed"));
		} finally {
			setPending(false);
		}
	}

	if (!status && !error) {
		return <p className="text-xs text-muted-foreground/70">{t("settings.billing.loading")}</p>;
	}

	const empty = status !== null && status.monthlyCentavos <= 0 && status.rechargeCentavos <= 0;

	return (
		<div className="flex flex-col gap-2">
			{error && <p role="alert" className="text-xs text-red-500">{error}</p>}
			{status && !status.configured && (
				<p className="text-xs text-muted-foreground">{t("settings.billing.unavailable")}</p>
			)}
			{status?.configured && (
				<>
					<SettingsRow label={t("settings.billing.plan")} hint={t("settings.billing.split")}>
						<span className="flex items-center gap-2">
							<span className="font-ui text-xs">{t("settings.billing.planPrice")}</span>
							<button type="button" className={ACTION} disabled={pending} data-testid="billing-subscribe" onClick={() => void openCheckout("/api/billing/subscribe")}>
								{pending ? t("settings.billing.working") : t("settings.billing.subscribe")}
							</button>
						</span>
					</SettingsRow>
					<SettingsRow label={t("settings.billing.monthly")}>
						<span className="font-ui text-xs" data-testid="billing-monthly">{mxn(status.monthlyCentavos)}</span>
					</SettingsRow>
					<SettingsRow label={t("settings.billing.rechargeBalance")} hint={t("settings.billing.rechargeHint")}>
						<span className="font-ui text-xs" data-testid="billing-recharge-balance">{mxn(status.rechargeCentavos)}</span>
					</SettingsRow>
					<SettingsRow label={t("settings.billing.amount")}>
						<span className="flex items-center gap-2">
							<input
								aria-label={t("settings.billing.amount")}
								inputMode="numeric"
								value={amount}
								onChange={(event) => setAmount(event.target.value)}
								className="h-7 w-20 rounded-sm border border-border bg-background px-1.5 font-ui text-xs"
							/>
							<button
								type="button"
								className={ACTION}
								disabled={pending}
								data-testid="billing-recharge"
								onClick={() => void openCheckout("/api/billing/recharge", { amountMxn: Number(amount) })}
							>
								{t("settings.billing.recharge")}
							</button>
						</span>
					</SettingsRow>
					{status.payAsYouGo && <p className="text-xs text-muted-foreground">{t("settings.billing.paygOn")}</p>}
					{empty && !status.payAsYouGo && <p className="text-xs text-muted-foreground">{t("settings.billing.empty")}</p>}
				</>
			)}
		</div>
	);
}
