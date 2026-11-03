const { dependencyArgs, dependencyRunArgsNoDeps, root } = require("./compose.cjs");

module.exports = {
	apps: [
		{
			name: "mongo",
			script: "docker",
			args: dependencyArgs("mongo"),
			cwd: root,
			kill_timeout: 15000,
			autorestart: false,
			watch: false,
		},
		{
			name: "silo",
			script: "docker",
			args: dependencyArgs("silo"),
			cwd: root,
			kill_timeout: 15000,
			autorestart: false,
			watch: false,
		},
		{
			name: "mongo-init",
			script: "docker",
			args: dependencyRunArgsNoDeps("mongo-init"),
			cwd: root,
			kill_timeout: 15000,
			autorestart: false,
			watch: false,
		},
		{
			name: "createbuckets",
			script: "docker",
			args: dependencyRunArgsNoDeps("createbuckets"),
			cwd: root,
			kill_timeout: 15000,
			autorestart: false,
			watch: false,
		},
	],
};
