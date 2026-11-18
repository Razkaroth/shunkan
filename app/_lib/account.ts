import { cookies, headers } from "next/headers";
import { requestAccountId } from "@/src/server";

/** The signed-in Payload user, or null. Product pages redirect when this is missing. */
export async function pageAccountId(): Promise<string | null> {
	const headerList = await headers();
	const jar = await cookies();
	const requestHeaders = new Headers(headerList);
	requestHeaders.set("cookie", jar.toString());
	return requestAccountId(new Request("http://localhost/", { headers: requestHeaders }));
}
