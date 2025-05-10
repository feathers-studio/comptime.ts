import type { Plugin } from "vite";
import MagicString from "magic-string";
import { type Replacements, getComptimeReplacements } from "./comptime.ts";

export async function comptime(tsconfigPath?: string): Promise<Plugin> {
	let replacements: Replacements;

	return {
		name: "vite-plugin-comptime",
		async buildStart() {
			replacements = await getComptimeReplacements({ tsconfigPath });
		},
		transform(code, id) {
			const replacement = replacements[id];
			if (!replacement) return null;

			const s = new MagicString(code);

			for (const r of replacement) {
				s.overwrite(r.start, r.end, r.replacement);
			}

			return { code: s.toString(), map: s.generateMap() };
		},
	};
}
