const path = require("node:path");
const { root } = require("./compose.cjs");

module.exports = {
	apps: [
		{
			name: "cursor-worker",
			script: "bash",
			args: ["-lc", `exec ${path.join(root, "devenv/agent-worker.sh")} run`],
			cwd: root,
			autorestart: true,
			watch: false,
			kill_timeout: 10000,
			max_restarts: 5,
			min_uptime: "10s",
			exp_backoff_restart_delay: 2000,
		},
	],
};
