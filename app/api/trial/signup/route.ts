/**
 * The one account this trial needs, after the GPT-Sol session ends.
 * Public email signup stays disabled; this route creates the user itself.
 */
import { signUpFromTrial, trialBrowserAllowed, trialErrorResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { email?: unknown; name?: unknown; password?: unknown };
	if (!trialBrowserAllowed(req)) return Response.json({ error: "Open this from LearnHarness." }, { status: 403 });
	try {
		const { accountId } = await signUpFromTrial(req, body);
		return Response.json({ accountId }, { status: 201 });
	} catch (err) {
		return trialErrorResponse(err);
	}
}
