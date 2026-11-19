/**
 * Open a profile that belongs to the signed-in Payload user, or change user.
 * A different user is refused. The one unsigned trial profile is the
 * exception, and only until its signup attaches an owner.
 */
import {
	clearedSessionCookieHeader,
	endSession,
	loginRedirect,
	requestAccountId,
	sessionCookieHeader,
	TrialError,
	trialErrorResponse,
	unlockProfile,
	unlockUnsignedTrial,
	usersErrorResponse,
} from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { id?: unknown; pin?: unknown };
	const accountId = await requestAccountId(req);
	if (!accountId) {
		try {
			const sessionId = unlockUnsignedTrial(body.id, body.pin);
			return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookieHeader(sessionId) } });
		} catch (err) {
			if (err instanceof TrialError && err.message === "Wrong PIN.") return trialErrorResponse(err);
			return loginRedirect(req);
		}
	}
	try {
		const sessionId = unlockProfile(body.id, body.pin, accountId);
		return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookieHeader(sessionId) } });
	} catch (err) {
		return usersErrorResponse(err);
	}
}

export function DELETE(req: Request) {
	endSession(req);
	return Response.json({ ok: true }, { headers: { "Set-Cookie": clearedSessionCookieHeader() } });
}
