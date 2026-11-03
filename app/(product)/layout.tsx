import type { Metadata } from "next";
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { PhoneLayoutProvider } from "@/components/phone-layout-context";
import { ServerEventsProvider } from "@/components/server-events";
import { AppearanceProvider } from "@/components/settings/appearance";
import UpdateBanner from "@/components/update-banner";
import { I18nProvider } from "@/components/i18n";
import { ProductTour } from "@/components/product-tour";
import { translate } from "@/src/core";
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
	const signedIn = (await pageUserId()) !== null;
	const language = await pageLanguage();
	return (
		<I18nProvider initialLanguage={language}>
			{signedIn ? (
				<ProductTour>
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
				</ProductTour>
			) : (
				children
			)}
			<UpdateBanner />
		</I18nProvider>
	);
}
