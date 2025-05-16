#!/usr/bin/env node

import { parseArgs } from "node:util";
import { applyComptimeReplacements, comptimeCompiler } from "./api.ts";
import { getTypeInfoReplacements } from "./typeInfo.ts";

const args = parseArgs({
	options: {
		help: {
			type: "boolean",
			short: "h",
		},
		typeInfo: {
			type: "boolean",
			short: "T",
			default: false,
		},
		project: {
			type: "string",
			short: "p",
			default: "tsconfig.json",
		},
		outdir: {
			type: "string",
			short: "o",
			default: "./out",
		},
	},
});

if (args.values.help) {
	console.log("Usage: ts-comptime <options>");
	console.log("Options:");
	console.log("  -h, --help        Show help");
	console.log("  -p, --project     Path to tsconfig.json (default: tsconfig.json)");
	console.log("  -o, --outdir      Output directory (default: ./out)");
}

if (args.values.help) {
	console.log("Usage: ts-comptime <options>");
	console.log("Options:");
	console.log("  -h, --help        Show help");
	console.log("  -T, --typeInfo    Generate type info (unstable, will be merged into main compiler)");
	console.log("  -p, --project     Path to tsconfig.json (default: tsconfig.json)");
	console.log("  -o, --outdir      Output directory (default: ./out)");
}

const tsconfigPath = args.values.project;
const outdir = args.values.outdir;

if (args.values.typeInfo) {
	const replacements = await getTypeInfoReplacements({ tsconfigPath });
	await applyComptimeReplacements({ tsconfigPath, outdir }, replacements);
} else await comptimeCompiler({ tsconfigPath }, outdir);
