export function formatResolvedValue(resolved: unknown): string {
	if (resolved === null) return "null";
	const t = typeof resolved;
	if (resolved === undefined || t === 'undefined') return "undefined";
	if (t === 'boolean') return resolved ? "true" : "false";
	if (t === 'number') return String(resolved);
	if (t === 'bigint') return String(resolved) + 'n';
	if (t === 'string') return JSON.stringify(resolved);
	if (Array.isArray(resolved)) return '[' + resolved.map(formatResolvedValue).join(', ') + ']';
	if (resolved instanceof Date) return 'new Date(' + resolved.getTime() + ')';
	if (resolved instanceof Set) return 'new Set([' + [...resolved.values()].map(formatResolvedValue).join(', ') + '])';
	if (resolved instanceof Map) return 'new Map([' + [...resolved.entries()].map(([k,v]): string => '[' + formatResolvedValue(k) + ', ' + formatResolvedValue(v) + ']').join(', ') + '])';
	// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Typed_arrays#typed_array_views
	if (resolved instanceof Int8Array) return 'new Int8Array([' + [...resolved.values()].join(', ') + '])';
	if (resolved instanceof Uint8Array) return 'new Uint8Array([' + [...resolved.values()].join(', ') + '])';
	if (resolved instanceof Uint8ClampedArray) return 'new Uint8ClampedArray([' + [...resolved.values()].join(', ') + '])';
	if (resolved instanceof Int16Array) return 'new Int16Array([' + [...resolved.values()].join(', ') + '])';
	if (resolved instanceof Uint16Array) return 'new Uint16Array([' + [...resolved.values()].join(', ') + '])';
	if (resolved instanceof Int32Array) return 'new Int32Array([' + [...resolved.values()].join(', ') + '])';
	if (resolved instanceof Uint32Array) return 'new Uint32Array([' + [...resolved.values()].join(', ') + '])';
	// TODO: Enable Float16Array once it sees more adoption
	// if (resolved instanceof Float16Array) return 'new Float16Array([' + [...resolved.values()].join(', ') + '])';
	if (resolved instanceof Float32Array) return 'new Float32Array([' + [...resolved.values()].join(', ') + '])';
	if (resolved instanceof Float64Array) return 'new Float64Array([' + [...resolved.values()].join(', ') + '])';
	if (resolved instanceof BigInt64Array) return 'new BigInt64Array([' + [...resolved.values()].map(formatResolvedValue).join(', ') + '])';
	if (resolved instanceof BigUint64Array) return 'new BigUint64Array([' + [...resolved.values()].map(formatResolvedValue).join(', ') + '])';
	// prevent bare object becoming a statement and becoming invalid syntax
	if (t === "object") return '({' + Object.entries(resolved).map(([k,v]) => formatResolvedValue(k) + ': ' + formatResolvedValue(v)).join(', ') + '})';
	if (t === 'function') return String(resolved); // pray that it isn't a closure
	if (t === 'symbol') throw new Error('Emitting symbols will have unexpected consequences');
	// fallback to JSON.stringify for other types
	return '(' + JSON.stringify(resolved) + ')';
}
