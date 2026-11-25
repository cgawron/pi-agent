#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const [defaultsPath, settingsPath] = process.argv.slice(2);
if (!defaultsPath || !settingsPath) {
	throw new Error("Usage: merge-settings.js <defaults.json> <settings.json>");
}

const defaults = JSON.parse(fs.readFileSync(defaultsPath, "utf8"));
let settings = {};
try {
	settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
} catch (error) {
	if (error.code !== "ENOENT") throw error;
}

for (const [key, value] of Object.entries(defaults)) {
	if (key === "skills" && Array.isArray(value)) {
		settings.skills = [...new Set([...(Array.isArray(settings.skills) ? settings.skills : []), ...value])];
	} else if (!(key in settings)) {
		settings[key] = value;
	}
}

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
const temporaryPath = `${settingsPath}.${process.pid}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`);
fs.renameSync(temporaryPath, settingsPath);
