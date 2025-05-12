import { readFile } from "node:fs/promises";

import type { Plugin } from "vite";
import MagicString from "magic-string";
import { type GetComptimeReplacementsOpts, type Replacements, getComptimeReplacements } from "./comptime.ts";

export async function comptime(opts?: GetComptimeReplacementsOpts): Promise<Plugin> {
	let replacements: Replacements;

	return {
		name: "vite-plugin-comptime",
		async buildStart() {
			replacements = await getComptimeReplacements(opts);
		},
		async load(id) {
			const replacement = replacements[id];
			if (!replacement) return null;

			const code = await readFile(id, "utf-8");

			const s = new MagicString(code);

			for (const r of replacement) {
				s.overwrite(r.start, r.end, r.replacement);
			}

			return { code: s.toString(), map: s.generateMap() };
		},
	};
}
