/** The signed-in trial state. No invite code is returned. */
import { trialStatusForRequest } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
	return Response.json(trialStatusForRequest(req));
}
