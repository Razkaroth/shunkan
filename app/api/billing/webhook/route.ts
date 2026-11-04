/** Signed Stripe events. Fulfillment lives here, not on the success page. */
import { billingWebhookResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const body = await req.text();
	return billingWebhookResponse(body, req.headers.get("stripe-signature"));
}
