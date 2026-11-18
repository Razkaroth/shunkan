/** Store a drawing from the message image control on the private learner-images collection. */
import { saveLearnerImageResponse, usersErrorResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { data?: unknown; mimeType?: unknown };
	try {
		return await saveLearnerImageResponse(req, body);
	} catch (err) {
		return usersErrorResponse(err);
	}
}
