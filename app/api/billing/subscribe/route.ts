/** Start the Basic subscription checkout for the signed-in profile. */
import { billingErrorResponse, startBasicCheckout } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	try {
		return Response.json(await startBasicCheckout(req));
	} catch (err) {
		return billingErrorResponse(err);
	}
}
