import { applyComptimeReplacements, getComptimeReplacements } from "./comptime.ts";

export type { ComptimeFunction, Replacements } from "./comptime.ts";
export { getComptimeReplacements, applyComptimeReplacements };

export async function comptime(tsconfigPath: string, outdir: string) {
	const replacements = await getComptimeReplacements({ tsconfigPath });
	await applyComptimeReplacements({ tsconfigPath, outdir }, replacements);
}
