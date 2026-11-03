import type { Metadata } from "next";
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { PhoneLayoutProvider } from "@/components/phone-layout-context";
import { ServerEventsProvider } from "@/components/server-events";
import { AppearanceProvider } from "@/components/settings/appearance";
import UpdateBanner from "@/components/update-banner";
import { TrialSignup } from "@/components/trial-flow";
import { I18nProvider } from "@/components/i18n";
import { translate } from "@/src/core";
import { trialStatusFor } from "@/src/server";
import { pageLanguage } from "../_lib/language";
import { pageUserId } from "../_lib/user";

export async function generateMetadata(): Promise<Metadata> {
	const language = await pageLanguage();
	return {
		title: "Learning Harness",
		description: translate(language, "nav.meta.description"),
	};
}

export const dynamic = "force-dynamic";

export default async function ProductLayout({ children }: { children: React.ReactNode }) {
	const userId = await pageUserId();
	const signedIn = userId !== null;
	const trial = userId ? trialStatusFor(userId) : null;
	const language = await pageLanguage();
	if (trial?.signupRequired) {
		return (
			<I18nProvider initialLanguage={language}>
				<TrialSignup />
			</I18nProvider>
		);
	}
	return (
		<I18nProvider initialLanguage={language}>
			{signedIn ? (
				<ServerEventsProvider>
					<AppearanceProvider>
						<PhoneLayoutProvider>
							<SidebarProvider>
								<ActivityProvider>
									<AppShell>{children}</AppShell>
								</ActivityProvider>
							</SidebarProvider>
						</PhoneLayoutProvider>
					</AppearanceProvider>
				</ServerEventsProvider>
			) : (
				children
			)}
			<UpdateBanner />
		</I18nProvider>
	);
}
