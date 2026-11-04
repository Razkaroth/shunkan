import type { Access, GlobalConfig } from "payload";

const adminOnly: Access = ({ req }) => {
	const role = req.user && "role" in req.user ? req.user.role : undefined;
	const roles = Array.isArray(role) ? role : role ? [role] : [];
	return roles.includes("super-admin") || roles.includes("admin");
};

/**
 * One checkbox per flag. The field name is the flag, which is what types
 * the set. Pay as you go launches off: an empty balance is a block, not a bill.
 */
export const FeatureFlags: GlobalConfig = {
	slug: "feature-flags",
	label: "Feature flags",
	admin: {
		group: "Product",
		description: "Each flag is its own checkbox. Off is the launch default.",
	},
	access: {
		read: adminOnly,
		update: adminOnly,
	},
	fields: [
		{
			name: "payAsYouGo",
			label: "Pay as you go",
			type: "checkbox",
			defaultValue: false,
			admin: {
				description: "When on, a user with no monthly tokens and no recharge can keep spending and Stripe bills that use. When off, that spend is blocked. Launch default is off: we do not extend credit.",
			},
		},
	],
};
