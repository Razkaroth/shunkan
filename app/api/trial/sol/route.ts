/** Start the one GPT-Sol session, or return the chat that is already open. */
import { startSolSession, trialErrorResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
	try {
		return Response.json(startSolSession(req));
	} catch (err) {
		return trialErrorResponse(err);
	}
}
