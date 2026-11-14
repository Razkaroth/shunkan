import { handleChatRequest, wakeSession, withUser } from "@/src/server";

async function handlePOST(req: Request) {
	// Referenced so start() stays statically reachable from this route.
	void wakeSession;
	return handleChatRequest(req);
}

export const POST = withUser(handlePOST);
