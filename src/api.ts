import {
	applyComptimeReplacements,
	getComptimeReplacements,
	type GetComptimeReplacementsOpts,
	type Filterable,
} from "./comptime.ts";

export type { Replacements } from "./comptime.ts";
export { getComptimeReplacements, applyComptimeReplacements };

export async function comptimeCompiler(opts?: Filterable<GetComptimeReplacementsOpts>, outdir?: string) {
	const replacements = await getComptimeReplacements(opts);
	await applyComptimeReplacements({ ...opts, outdir }, replacements);
}
