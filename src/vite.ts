import { readFile } from "node:fs/promises";

import type { FilterPattern, Plugin } from "vite";
import { createFilter } from "vite";
import MagicString from "magic-string";
import { type GetComptimeReplacementsOpts, type Replacements, getComptimeReplacements } from "./comptime.ts";

export type ComptimeVitePluginOpts = GetComptimeReplacementsOpts & {
	include?: FilterPattern;
	exclude?: FilterPattern;
};

export async function comptime(opts?: ComptimeVitePluginOpts): Promise<Plugin> {
	const filter = createFilter(opts?.include, opts?.exclude);
	let replacements: Replacements;

	return {
		name: "vite-plugin-comptime",
		async buildStart() {
			const resolver = (specifier: string, importer: string) =>
				this.resolve(specifier, importer).then(res => res?.id);
			replacements = await getComptimeReplacements({ ...opts, resolver, filter });
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
