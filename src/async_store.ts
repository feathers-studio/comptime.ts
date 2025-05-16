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

let AsyncLocalStorage: new () => AsyncContext<{ __comptime_context: ComptimeContext }>;

try {
	// avoid an unnecessary import if we're not in a node-like environment
	if (typeof process === "undefined") throw new Error("process is undefined, using NoopAsyncLocalStorage");
	AsyncLocalStorage = await import("node:async_hooks").then(m => m.AsyncLocalStorage);
} catch {
	// if we're not in a node-like environment, use a noop implementation, no need to error
	class NoopAsyncLocalStorage<T> implements AsyncContext<T> {
		run<R>(_: T, callback: () => R): R {
			return callback();
		}
		getStore(): T | undefined {
			return undefined;
		}
	}

	AsyncLocalStorage = NoopAsyncLocalStorage;
}

export const asyncLocalStore = AsyncLocalStorage && new AsyncLocalStorage();
