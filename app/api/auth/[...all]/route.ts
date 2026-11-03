import config from "@payload-config";
import { getPayloadAuth } from "payload-auth/better-auth/plugin";

const handle = async (request: Request) => {
	const payload = await getPayloadAuth(config);
	return payload.betterAuth.handler(request);
};

export const GET = handle;
export const POST = handle;
