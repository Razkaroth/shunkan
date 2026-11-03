import type { Access, CollectionConfig } from "payload";

const adminOnly: Access = ({ req }) => {
	const role = req.user && "role" in req.user ? req.user.role : undefined;
	const roles = Array.isArray(role) ? role : role ? [role] : [];
	return roles.includes("super-admin") || roles.includes("admin");
};

/** Upload slot for later demo files. Not a media library. */
export const DemoFiles: CollectionConfig = {
	slug: "demo-files",
	upload: true,
	admin: {
		group: "Files",
		description: "S3 storage for later demo files.",
	},
	access: {
		read: adminOnly,
		create: adminOnly,
		update: adminOnly,
		delete: adminOnly,
	},
	fields: [{ name: "alt", type: "text" }],
};
