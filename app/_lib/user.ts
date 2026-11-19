import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { registryExists, requestBoundProfile } from "@/src/server";

/** The signed-in profile on this browser, or null when it belongs to another account. */
export async function pageUserId(): Promise<string | null> {
	if (!registryExists()) return null;
	const jar = await cookies();
	const header = new Headers();
	const serialized = jar.toString();
	if (serialized) header.set("cookie", serialized);
	const profile = await requestBoundProfile(new Request("http://localhost/", { headers: header }));
	return profile?.id ?? null;
}

/** Pages behind a profile: an unclaimed install or a missing session
 *  lands on the select screen. */
export async function requirePageUser(): Promise<string> {
	const userId = await pageUserId();
	if (!userId) redirect("/users");
	return userId;
}
