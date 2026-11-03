/**
 * Attaches the active profile's Stripe customer id to AI Gateway requests.
 * The gateway writes Billing Meter events; nothing here creates prices,
 * invoices, or a second usage ledger.
 */
import { activeUserId } from "../../config.ts";
import { configureGatewayCustomer } from "../agent/gateway-provision.ts";
import { readProfiles } from "../store/users.ts";

configureGatewayCustomer(() => {
	const id = activeUserId();
	if (!id) return undefined;
	return readProfiles().find((profile) => profile.id === id)?.stripeCustomerId;
});
