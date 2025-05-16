import { process } from "./util.ts";

export type Defer = () => void | Promise<void>;

export interface ComptimeContext {
	sourceFile: string;
	deferQueue: Defer[];
	position: {
		start: number;
		end: number;
	};
}

export interface AsyncContext<T> {
	run<R>(store: T, callback: () => R): R;
	getStore(): T | undefined;
}

export let asyncLocalStore: AsyncContext<{ __comptime_context: ComptimeContext }>;

try {
	// avoid an unnecessary import attempt if we're not in a node-like environment
	if (!process) throw new Error();
	const AsyncLocalStorage = (await import("node:async_hooks")).AsyncLocalStorage;
	asyncLocalStore = new AsyncLocalStorage();
} catch {
	// noop AsyncLocalStorage implementation if we're not in a node-like environment
	asyncLocalStore = {
		run: (_, callback) => callback(),
		getStore: () => undefined,
	};
}
