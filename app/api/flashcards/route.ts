import { flashcardsGenerate, flashcardsReview, flashcardsState, flashcardsWrite, withUser } from "@/src/server";

export const dynamic = "force-dynamic";

async function handleGET(): Promise<Response> {
	return flashcardsState();
}

async function handlePOST(request: Request): Promise<Response> {
	const body = await request.json() as { action?: string; propositionId?: string; rating?: number; nodeIds?: string[] };
	if (body.action === "review") return flashcardsReview(body);
	if (body.action === "generate") return flashcardsGenerate(body);
	return flashcardsWrite(body);
}

export const GET = withUser(handleGET);
export const POST = withUser(handlePOST);
