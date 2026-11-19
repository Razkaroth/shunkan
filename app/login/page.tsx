import { I18nProvider } from "@/components/i18n";
import { TrialRedeem } from "@/components/trial-flow";
import { trialStatusFor } from "@/src/server";
import { pageLanguage } from "../_lib/language";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
	const language = await pageLanguage();
	const trialOpen = trialStatusFor(null).open;
	return (
		<I18nProvider initialLanguage={language}>
			<main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
				<LoginForm />
				{trialOpen ? <TrialRedeem language={language} /> : null}
			</main>
		</I18nProvider>
	);
}
