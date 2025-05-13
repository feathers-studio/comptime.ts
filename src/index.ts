import {
	applyComptimeReplacements,
	getComptimeReplacements,
	type GetComptimeReplacementsOpts,
	type ComptimeContext,
} from "./comptime.ts";
import { COMPTIME_ERRORS, getErr } from "./errors.ts";

export type { ComptimeFunction, Replacements, ComptimeContext } from "./comptime.ts";
export { getComptimeReplacements, applyComptimeReplacements };

export async function comptimeCompiler(opts?: GetComptimeReplacementsOpts, outdir?: string) {
	const replacements = await getComptimeReplacements(opts);
	await applyComptimeReplacements({ ...opts, outdir }, replacements);
}

declare const __comptime_symbol: symbol | undefined;

/**
 * A function that returns the expression it was given.
 * This is useful to force comptime evaluation of an expression.
 *
 * Note that if the provided expression resolves to a Promise-like value,
 * it will be awaited and resolved to a value at comptime.
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
export const comptime = <T>(expr: T | PromiseLike<T>): T => {
	if (typeof __comptime_symbol === "undefined") throw new Error(getErr(COMPTIME_ERRORS.CT_ERR_NO_COMPTIME));

	return expr as T;
};
