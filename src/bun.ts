import { type BunPlugin } from "bun";
import { getComptimeReplacements, type GetComptimeReplacementsOpts, type Replacements } from "./comptime.ts";
import MagicString from "magic-string";

export type ComptimeBunPluginOpts = GetComptimeReplacementsOpts & {
	filter?: RegExp;
};

export const comptime = (opts?: ComptimeBunPluginOpts): BunPlugin => {
	const filter = opts?.filter && ((id: string) => opts.filter!.test(id));
	let replacements: Replacements;

	return {
		name: "bun-plugin-comptime",
		setup(build) {
			build
				.onStart(async () => {
					replacements = await getComptimeReplacements({ ...opts, filter });
				})
				.onLoad({ filter: opts?.filter ?? /\.(ts|tsx|js|jsx|mjs|cjs)$/ }, async args => {
					const id = args.path;

					const replacement = replacements[id];
					if (!replacement) return;

					const code = await Bun.file(id).text();

					const s = new MagicString(code);

					for (const r of replacement) {
						s.overwrite(r.start, r.end, r.replacement);
					}

					return { contents: s.toString() };
				});
		},
	};
};
