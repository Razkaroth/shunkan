import type { Access, CollectionConfig } from "payload";

const adminOnly: Access = ({ req }) => {
	const role = req.user && "role" in req.user ? req.user.role : undefined;
	const roles = Array.isArray(role) ? role : role ? [role] : [];
	return roles.includes("super-admin") || roles.includes("admin");
};

/**
 * One document per former data file (chat, ledger, settings, keys, job,
 * profile, prompt override, subscription credential). The product server
 * reads and writes these through the Mongo driver; this collection is the
 * admin view and the schema. Bodies can hold API keys.
 */
export const LearnerRecords: CollectionConfig = {
	slug: "learner-records",
	admin: {
		group: "Learning",
		useAsTitle: "path",
		description: "Durable learner data. Includes private keys. Admin access only.",
		defaultColumns: ["path", "kind", "updatedAt"],
	},
	access: {
		read: adminOnly,
		create: adminOnly,
		update: adminOnly,
		delete: adminOnly,
	},
	fields: [
		{ name: "path", type: "text", required: true, unique: true, index: true },
		{ name: "kind", type: "text", required: true, index: true },
		{ name: "body", type: "textarea", required: true },
	],
};
