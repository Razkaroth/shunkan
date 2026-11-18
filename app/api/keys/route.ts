/**
 * GET /api/keys — the auth page's key list.
 *
 * Masked last-4 and length are key material. A profile that is not the
 * product admin receives an empty key list. Provider names stay, because
 * they are not key material. An unclaimed install has no profile yet and
 * still receives the list so the first admin can set keys up.
 */
import { keyStatuses, providerKeyList, requestProfile, withUser } from "@/src/server";

export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
	const profile = requestProfile(req);
	if (profile && profile.role !== "admin") {
		return Response.json({ keys: [], providers: providerKeyList() });
	}
	return Response.json({ keys: keyStatuses(), providers: providerKeyList() });
}

export const GET = withUser(handleGET);
