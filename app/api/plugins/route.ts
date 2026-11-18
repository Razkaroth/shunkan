/** The household's plugin toggles. A plugin the admin left unchecked cannot be turned on. */
import { pluginsResponse, setPluginResponse, usersErrorResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	try {
		return await pluginsResponse(req);
	} catch (err) {
		return usersErrorResponse(err);
	}
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { plugin?: unknown; enabled?: unknown };
	try {
		return await setPluginResponse(req, body);
	} catch (err) {
		return usersErrorResponse(err);
	}
}
