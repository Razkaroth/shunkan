/**
 * Attaches the active profile's Stripe customer id to AI Gateway requests.
 * The gateway writes Billing Meter events; nothing here creates prices,
 * invoices, or a second usage ledger.
 */
import { activeUserId } from "../../config.ts";
import { configureGatewayCustomer } from "../agent/gateway-provision.ts";
import { readProfiles } from "../store/users.ts";
import { familyCustomerId } from "./stripe-billing.ts";

configureGatewayCustomer(() => {
	const id = activeUserId();
	if (!id) return undefined;
	const profile = readProfiles().find((item) => item.id === id);
	if (!profile) return undefined;
	if (profile.ownerId) return familyCustomerId(profile.ownerId);
	return profile.stripeCustomerId;
});
