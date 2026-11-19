/**
 * The signed-in account's profiles. A request with no Payload session
 * redirects to the login page. It does not answer with an empty list.
 */
import { assertOwnAccount, createProfile, loginRedirect, requestAccountId, sessionCookieHeader, usersErrorResponse, usersSnapshot } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const accountId = await requestAccountId(req);
	if (!accountId) return loginRedirect(req);
	return Response.json(usersSnapshot(req, accountId));
}

export async function POST(req: Request) {
	const accountId = await requestAccountId(req);
	if (!accountId) return loginRedirect(req);
	const body = (await req.json().catch(() => ({}))) as { name?: unknown; color?: unknown; pin?: unknown; language?: unknown; ownerId?: unknown };
	try {
		assertOwnAccount(body.ownerId, accountId);
		const { profile, sessionId } = createProfile(req, body, accountId);
		const headers = sessionId ? { "Set-Cookie": sessionCookieHeader(sessionId) } : undefined;
		return Response.json({ profile, signedIn: sessionId !== null }, { status: 201, headers });
	} catch (err) {
		return usersErrorResponse(err);
	}
}
