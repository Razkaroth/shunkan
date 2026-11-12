const { root } = require("./compose.cjs");

const port = process.env.APP_PORT || "3300";

module.exports = {
	apps: [
		{
			name: "shunkan",
			script: "pnpm",
			args: ["run", "dev", "--", "--port", port, "--hostname", "127.0.0.1"],
			cwd: root,
			interpreter: "none",
			kill_timeout: 10000,
			autorestart: false,
			watch: false,
		},
	],
};
