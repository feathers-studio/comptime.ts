#!/usr/bin/env node

import { parseArgs } from "node:util";
import { comptimeCompiler } from "./index.ts";

const args = parseArgs({
	options: {
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

const tsconfigPath = args.values.project;
const outdir = args.values.outdir;

await comptimeCompiler({ tsconfigPath }, outdir);
