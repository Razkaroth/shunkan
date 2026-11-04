/** Start a one-time recharge checkout. The body is `{ amountMxn }`. */
import { billingErrorResponse, startRechargeCheckout } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { amountMxn?: unknown };
	try {
		return Response.json(await startRechargeCheckout(req, body.amountMxn));
	} catch (err) {
		return billingErrorResponse(err);
	}
}
