#!/usr/bin/env node
"use strict";

const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = process.env.PI_AGENT_PLUGINS_FILE || "/etc/pi-agent/plugins.json";
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME, ".pi", "agent");
const statePath = path.join(agentDir, ".pi-agent-plugin-state.json");

function run(command, args, { allowFailure = false } = {}) {
	const result = spawnSync(command, args, { stdio: "inherit" });
	if (result.error) {
		if (allowFailure) return;
		throw result.error;
	}
	if (result.status !== 0 && !allowFailure) {
		process.exit(result.status || 1);
	}
}

function bundledPath(relativePath) {
	return path.join(npmRoot, relativePath);
}

function piPackageSource(plugin) {
	if (plugin.source === "bundled" || plugin.source === "global") {
		return bundledPath(plugin.path);
	}
	if (plugin.source === "npm") {
		return `npm:${plugin.package}`;
	}
	throw new Error(`Unsupported Pi package source: ${plugin.source}`);
}

function findSetupScript(setup) {
	const findArgs = [agentDir, "-name", setup.find.name];
	if (setup.find.pathIncludes) {
		findArgs.push("-path", `*${setup.find.pathIncludes}*`);
	}
	findArgs.push("-print", "-quit");
	const result = spawnSync("find", findArgs, { encoding: "utf8" });
	if (result.status !== 0 || !result.stdout.trim()) {
		throw new Error(`Could not find ${setup.find.name} under ${agentDir}`);
	}
	return result.stdout.trim();
}

function installPiPackages({ setup = false } = {}) {
	for (const plugin of manifest.piPackages || []) {
		run("pi", ["install", piPackageSource(plugin)]);
		if (setup && plugin.setup) {
			const scriptPath = findSetupScript(plugin.setup);
			const args = plugin.setup.args.map((arg) => arg.replaceAll("${script}", scriptPath));
			run(plugin.setup.command, args);
		}
	}
}

function readState() {
	try {
		return JSON.parse(fs.readFileSync(statePath, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return {};
		throw error;
	}
}

function removeStalePiPackages(previousState) {
	const currentSources = new Set((manifest.piPackages || []).map(piPackageSource));
	for (const plugin of previousState.piPackages || []) {
		const source = piPackageSource(plugin);
		if (!currentSources.has(source)) {
			run("pi", ["remove", source], { allowFailure: true });
		}
	}
}

function removeLegacyPiPackages() {
	for (const plugin of manifest.removePiPackages || []) {
		run("pi", ["remove", piPackageSource(plugin)], { allowFailure: true });
	}
}

function webPluginDirectory() {
	if (process.env.PI_WEB_DATA_DIR) {
		return path.join(process.env.PI_WEB_DATA_DIR, "plugins");
	}
	return "/home/node/.pi-web/plugins";
}

function linkPiWebPlugins() {
	const pluginDir = webPluginDirectory();
	fs.mkdirSync(pluginDir, { recursive: true });

	for (const plugin of manifest.piWebPlugins || []) {
		const source = bundledPath(plugin.package);
		const destination = path.join(pluginDir, plugin.id);
		const destinationStat = fs.lstatSync(destination, { throwIfNoEntry: false });
		if (destinationStat) {
			if (!destinationStat.isSymbolicLink()) continue;
			fs.unlinkSync(destination);
		}
		fs.symlinkSync(source, destination);
	}
}

function removeStalePiWebPlugins(previousState) {
	const currentIds = new Set((manifest.piWebPlugins || []).map((plugin) => plugin.id));
	const pluginDir = webPluginDirectory();
	for (const id of previousState.piWebPluginIds || []) {
		if (currentIds.has(id)) continue;
		const destination = path.join(pluginDir, id);
		const destinationStat = fs.lstatSync(destination, { throwIfNoEntry: false });
		if (destinationStat?.isSymbolicLink()) fs.unlinkSync(destination);
	}
}

function writeState() {
	fs.mkdirSync(path.dirname(statePath), { recursive: true });
	fs.writeFileSync(
		statePath,
		`${JSON.stringify(
			{
				piPackages: manifest.piPackages || [],
				piWebPluginIds: (manifest.piWebPlugins || []).map((plugin) => plugin.id),
			},
			null,
			2,
		)}\n`,
	);
}

function writeWebDefaults() {
	const plugins = Object.fromEntries(
		(manifest.piWebPlugins || []).map((plugin) => [plugin.id, { enabled: plugin.enabled !== false }]),
	);
	const defaultsPath = process.env.PI_WEB_DEFAULTS_CONFIG || "/home/node/.pi-web/defaults.json";
	fs.mkdirSync(path.dirname(defaultsPath), { recursive: true });
	fs.writeFileSync(defaultsPath, `${JSON.stringify({ plugins }, null, 2)}\n`);
}

const mode = process.argv[2];
if (mode === "system-packages") {
	process.stdout.write(`${(manifest.systemPackages || []).join(" ")}\n`);
} else if (mode === "install-web-dependencies") {
	const webPackages = (manifest.piWebPlugins || []).map((plugin) => plugin.package);
	if (webPackages.length > 0) {
		run("npm", ["install", "--global", "--allow-scripts=node-pty", ...webPackages]);
	}
} else if (mode === "install") {
	const previousState = readState();
	removeStalePiPackages(previousState);
	removeStalePiWebPlugins(previousState);
	installPiPackages({ setup: true });
	linkPiWebPlugins();
	writeWebDefaults();
	writeState();
} else if (mode === "bootstrap") {
	const previousState = readState();
	removeStalePiPackages(previousState);
	removeLegacyPiPackages();
	removeStalePiWebPlugins(previousState);
	installPiPackages();
	linkPiWebPlugins();
	writeState();
} else {
	throw new Error("Usage: manage-plugins.js <system-packages|install-web-dependencies|install|bootstrap>");
}
