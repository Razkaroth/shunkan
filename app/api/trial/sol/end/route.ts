/** End the GPT-Sol session before its reply lands. Signup is then required. */
import { endSolSession, trialErrorResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
	try {
		endSolSession(req);
		return Response.json({ ended: true });
	} catch (err) {
		return trialErrorResponse(err);
	}
}
