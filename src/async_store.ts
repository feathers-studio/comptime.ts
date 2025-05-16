import { AsyncLocalStorage } from "node:async_hooks";

export type Defer = () => void | Promise<void>;

export interface ComptimeContext {
	sourceFile: string;
	deferQueue: Defer[];
	position: {
		start: number;
		end: number;
	};
}

export const asyncLocalStore = new AsyncLocalStorage<{ __comptime_context?: ComptimeContext }>();
