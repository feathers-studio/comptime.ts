import { applyComptimeReplacements, getComptimeReplacements, type GetComptimeReplacementsOpts } from "./comptime.ts";

export type { ComptimeFunction, Replacements } from "./comptime.ts";
export { getComptimeReplacements, applyComptimeReplacements };

export async function comptimeCompiler(opts?: GetComptimeReplacementsOpts, outdir?: string) {
	const replacements = await getComptimeReplacements(opts);
	await applyComptimeReplacements({ ...opts, outdir }, replacements);
}

/**
 * A function that returns the expression it was given.
 * This is useful to force comptime evaluation of an expression.
 *
 * ## Usage
 *
 * Import the `comptime` function from `comptime.ts` with the `type: "comptime"` option.
 *
 * ```ts
 * import { comptime } from "comptime.ts" with { type: "comptime" };
 * ```
 *
 * Use it to force comptime evaluation of an expression.
 *
 * ```ts
 * const x = comptime(1 + 2);
 * ```
 *
 * When the compiler is run, the expression will be evaluated at compile time.
 *
 * ```ts
 * const x = 3;
 * ```
 */
export const comptime = <T>(expr: T) => expr;
