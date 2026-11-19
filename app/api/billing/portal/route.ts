/** Open a Stripe Customer Portal session for this account's customer. */
import { billingErrorResponse, startBillingPortal } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	try {
		return Response.json(await startBillingPortal(req));
	} catch (err) {
		return billingErrorResponse(err);
	}
}
