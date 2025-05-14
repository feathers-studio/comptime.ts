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

	let resolver: (specifier: string, importer: string) => Promise<string | undefined>;
	let replacements: Replacements;

	return {
		name: "vite-plugin-comptime",
		async buildStart() {
			resolver = (specifier: string, importer: string) => this.resolve(specifier, importer).then(res => res?.id);

			replacements = await getComptimeReplacements({ ...opts, resolver, filter });
		},
		async load(id) {
			const replacement = replacements[id];
			if (!replacement) return null;

			const mod = await this.load({ id });
			if (!mod || !mod.code) throw new Error(`Failed to load ${id}`);

			const s = new MagicString(mod.code);

			for (const r of replacement) {
				s.overwrite(r.start, r.end, r.replacement);
			}

			return { code: s.toString(), map: s.generateMap() };
		},
		async handleHotUpdate({ modules, file }) {
			if (!filter(file)) return;

			// find new replacements for *only* the affected file
			const newReplacements = await getComptimeReplacements({ ...opts, resolver, filter: id => id === file });

			// TODO: maybe diff the replacements to avoid unnecessary updates
			Object.assign(replacements, newReplacements);

			// fault all modules that depend on the affected file
			return modules;
		},
	};
}
