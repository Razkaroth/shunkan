import type { Access, GlobalConfig } from "payload";

const adminOnly: Access = ({ req }) => {
	const role = req.user && "role" in req.user ? req.user.role : undefined;
	const roles = Array.isArray(role) ? role : role ? [role] : [];
	return roles.includes("super-admin") || roles.includes("admin");
};

/**
 * One checkbox per plugin this install ships. Off until an admin turns it on.
 * There is no plugin directory and no upload of plugin code.
 */
export const Plugins: GlobalConfig = {
	slug: "plugins",
	label: "Plugins",
	admin: {
		group: "Product",
		description: "Each checkbox allows a signed-in household to turn that plugin on. Off is the default.",
	},
	access: {
		read: adminOnly,
		update: adminOnly,
	},
	fields: [
		{
			name: "flashcards",
			label: "Flashcards",
			type: "checkbox",
			defaultValue: false,
		},
		{
			name: "drawingPad",
			label: "Drawing pad",
			type: "checkbox",
			defaultValue: false,
		},
		{
			name: "richCodeBlocks",
			label: "Rich code blocks",
			type: "checkbox",
			defaultValue: false,
		},
	],
};
