import { redirect } from "next/navigation";
import { UserSelect } from "@/components/user-select";
import { trialStatusFor, usersSnapshot } from "@/src/server";
import { pageAccountId } from "../../_lib/account";
import { pageUserId } from "../../_lib/user";

export const dynamic = "force-dynamic";

/** The select screen for the signed-in account. A browser that already
 *  has a profile open goes back into the app. */
export default async function UsersPage() {
	const accountId = await pageAccountId();
	if (!accountId) redirect("/login");
	if (await pageUserId()) redirect("/");
	return <UserSelect snapshot={usersSnapshot(undefined, accountId)} trialOpen={trialStatusFor(null).open} />;
}
