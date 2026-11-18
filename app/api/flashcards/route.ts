import { flashcardsGenerate, flashcardsReview, flashcardsState, flashcardsWrite, pluginEnabled, requestProfile, withUser } from "@/src/server";

export const dynamic = "force-dynamic";

async function allowed(req: Request): Promise<boolean> {
	const profile = requestProfile(req);
	return pluginEnabled(profile?.ownerId, "flashcards");
}

async function handleGET(req: Request): Promise<Response> {
	if (!(await allowed(req))) return Response.json({ error: "That plugin is not available." }, { status: 403 });
	return flashcardsState();
}

async function handlePOST(request: Request): Promise<Response> {
	if (!(await allowed(request))) return Response.json({ error: "That plugin is not available." }, { status: 403 });
	const body = await request.json() as { action?: string; propositionId?: string; rating?: number; nodeIds?: string[] };
	if (body.action === "review") return flashcardsReview(body);
	if (body.action === "generate") return flashcardsGenerate(body);
	return flashcardsWrite(body);
}

export const GET = withUser(handleGET);
export const POST = withUser(handlePOST);
