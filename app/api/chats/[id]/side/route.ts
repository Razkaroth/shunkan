import { askSideChat, getChat, listSideChats, setSideChatOpen, stopSideChat, withUser } from "@/src/server";

export const dynamic = "force-dynamic";

async function handleGET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	if (!getChat(id)) return Response.json({ error: "unknown chat" }, { status: 404 });
	return listSideChats(id);
}

async function handlePOST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	if (!getChat(id)) return Response.json({ error: "unknown chat" }, { status: 404 });
	const body = await request.json() as { threadId?: string; open?: boolean; stop?: boolean };
	if (body.stop === true) {
		if (typeof body.threadId !== "string") return Response.json({ error: "threadId is required" }, { status: 400 });
		return stopSideChat(id, body.threadId);
	}
	if (typeof body.open === "boolean") {
		if (typeof body.threadId !== "string") return Response.json({ error: "threadId is required" }, { status: 400 });
		return setSideChatOpen(id, body.threadId, body);
	}
	return askSideChat(id, body);
}

export const GET = withUser(handleGET);
export const POST = withUser(handlePOST);
