/** Redeem the one university-trial invite. Signs the browser in as that friend. */
import { redeemTrialCode, sessionCookieHeader, trialErrorResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as {
		code?: unknown;
		name?: unknown;
		color?: unknown;
		pin?: unknown;
		language?: unknown;
	};
	try {
		const { profileId, sessionId } = redeemTrialCode(req, body);
		const headers = sessionId ? { "Set-Cookie": sessionCookieHeader(sessionId) } : undefined;
		return Response.json({ profileId, signedIn: sessionId !== null }, { status: 201, headers });
	} catch (err) {
		return trialErrorResponse(err);
	}
}
