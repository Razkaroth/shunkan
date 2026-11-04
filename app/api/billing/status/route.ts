/** Balances for the signed-in profile. Stripe is read; nothing is stored here. */
import { billingErrorResponse, billingStatus, payAsYouGoEnabled } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	try {
		return Response.json(await billingStatus(req, await payAsYouGoEnabled()));
	} catch (err) {
		return billingErrorResponse(err);
	}
}
