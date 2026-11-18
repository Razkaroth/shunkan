/** Product-admin view of each family's Stripe subscription, credit, and last failed payment. */
import { billingErrorResponse, familyBillingReport } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	try {
		return Response.json({ families: await familyBillingReport(req) });
	} catch (err) {
		return billingErrorResponse(err);
	}
}
