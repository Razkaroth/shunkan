import type { Access, GlobalConfig } from "payload";

const adminOnly: Access = ({ req }) => {
	const role = req.user && "role" in req.user ? req.user.role : undefined;
	const roles = Array.isArray(role) ? role : role ? [role] : [];
	return roles.includes("super-admin") || roles.includes("admin");
};

/**
 * One number per setting. The field name is the setting. Neither field has
 * a default: an empty global is not a price and not a grant.
 */
export const Pricing: GlobalConfig = {
	slug: "pricing",
	label: "Pricing",
	admin: {
		group: "Product",
		description: "Monthly price and the share of it granted as token credit. Leave either field empty and plan checkout waits. Nothing here assumes an amount.",
	},
	access: {
		read: adminOnly,
		update: adminOnly,
	},
	fields: [
		{
			name: "monthlyPriceMxn",
			label: "Monthly price (MXN)",
			type: "number",
			required: false,
			min: 0.01,
			admin: {
				step: 0.01,
				description: "Licensed Basic price for one month, in MXN. Empty means the plan price is not set.",
			},
		},
		{
			name: "commissionPercent",
			label: "Commission percentage",
			type: "number",
			required: false,
			min: 0,
			max: 100,
			admin: {
				step: 0.01,
				description: "Percent of the monthly price granted as token credit. The rest stays revenue. Empty means the grant is not set.",
			},
		},
	],
};
