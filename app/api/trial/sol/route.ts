/** Start the one GPT-Sol session, or return the chat that is already open. */
import { startSolSession, trialBrowserAllowed, trialErrorResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
	if (!trialBrowserAllowed(req)) return Response.json({ error: "Open this from LearnHarness." }, { status: 403 });
	try {
		return Response.json(startSolSession(req));
	} catch (err) {
		return trialErrorResponse(err);
	}
}
