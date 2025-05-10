#!/usr/bin/env node

import { parseArgs } from "node:util";
import { comptime } from "./index.ts";

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

const tsconfig = args.values.project;
const outdir = args.values.outdir;

await comptime(tsconfig, outdir);
