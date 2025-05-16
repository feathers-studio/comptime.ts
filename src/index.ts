import { type ComptimeContext, type Defer, asyncLocalStore } from "./async_store.ts";
import { COMPTIME_ERRORS, ComptimeError } from "./errors.ts";

export function getComptimeContext(): ComptimeContext | undefined {
	const local = asyncLocalStore.getStore();
	return typeof local === "object" ? local?.__comptime_context : undefined;
}

/**
 * Defer a function to be executed after comptime evaluation of all modules.
 *
 * ## Usage
 *
 * ```ts
 * comptime.defer(() => {
 * 	writeFileSync("foo.txt", "bar");
 * });
 * ```
 *
 * Please note that while all deferred functions are guaranteed to be executed after comptime evaluation,
 * they are not guaranteed to be executed in any specific order because modules are evaluated concurrently.
 */
function defer(fn: Defer) {
	const context = getComptimeContext();
	if (!context) throw new ComptimeError(COMPTIME_ERRORS.CT_ERR_NO_COMPTIME, "Invalid `comptime.defer()` call");
	context.deferQueue.push(() => {
		return asyncLocalStore.run({ __comptime_context: context }, fn);
	});
}

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
function comptime<T>(expr: T | PromiseLike<T>): T {
	const context = getComptimeContext();
	if (!context) throw new ComptimeError(COMPTIME_ERRORS.CT_ERR_NO_COMPTIME, "Invalid `comptime()` call");
	return expr as T;
}

const _comptime = Object.assign(comptime, { defer });

export { _comptime as comptime };
