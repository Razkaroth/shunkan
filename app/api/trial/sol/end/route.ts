/** End the GPT-Sol session before its reply lands. Signup is then required. */
import { endSolSession, trialBrowserAllowed, trialErrorResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
	if (!trialBrowserAllowed(req)) return Response.json({ error: "Open this from LearnHarness." }, { status: 403 });
	try {
		endSolSession(req);
		return Response.json({ ended: true });
	} catch (err) {
		return trialErrorResponse(err);
	}
}
