import path from "node:path";
import type { Access, CollectionConfig } from "payload";

const adminOnly: Access = ({ req }) => {
	const role = req.user && "role" in req.user ? req.user.role : undefined;
	const roles = Array.isArray(role) ? role : role ? [role] : [];
	return roles.includes("super-admin") || roles.includes("admin");
};

/** Private upload directory. The product route reads these bytes; this path is not a public URL. */
export function learnerImageDir(): string {
	const root = process.env.LH_DATA_DIR ? path.resolve(process.env.LH_DATA_DIR) : path.join(process.cwd(), "data");
	return path.join(root, "learner-images");
}

/** Browser uploads for one profile. Admin access only; the server writes with overrideAccess. */
export const LearnerImages: CollectionConfig = {
	slug: "learner-images",
	upload: {
		staticDir: learnerImageDir(),
		mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
		filesRequiredOnCreate: true,
	},
	admin: {
		group: "Learning",
		description: "Private learner images. No public URL. Admin access only.",
		defaultColumns: ["filename", "profileId", "updatedAt"],
	},
	access: {
		read: adminOnly,
		create: adminOnly,
		update: adminOnly,
		delete: adminOnly,
	},
	fields: [
		{ name: "profileId", type: "text", required: true, index: true },
	],
};
