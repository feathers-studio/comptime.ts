#!/usr/bin/env node

import { parseArgs } from "node:util";
import { comptimeCompiler } from "./index.ts";

const args = parseArgs({
	options: {
		help: {
			type: "boolean",
			short: "h",
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

const tsconfigPath = args.values.project;
const outdir = args.values.outdir;

await comptimeCompiler({ tsconfigPath }, outdir);
