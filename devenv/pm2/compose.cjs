const path = require("node:path");

const root = path.join(__dirname, "../..");
const composeBase = "compose --project-directory . -f devenv/compose.yml";

function dependencyArgs(service) {
	return `${composeBase} up ${service}`;
}

function dependencyRunArgsNoDeps(service) {
	return `${composeBase} run --rm --no-deps ${service}`;
}

module.exports = {
	dependencyArgs,
	dependencyRunArgsNoDeps,
	root,
};
