export function stringify(value: unknown): string {
	if (value === undefined) return "undefined";
	if (typeof value === "bigint") return value.toString() + "n";
	if (Array.isArray(value)) return `[${value.map(stringify).join(", ")}]`;
	if (typeof value === "object" && value !== null) {
		if (value instanceof Date) return `new Date(${value.getTime()})`;
		if (value instanceof Set) return `new Set(${Array.from(value).map(stringify).join(", ")})`;
		if (value instanceof Map)
			return `new Map(${Array.from(value)
				.map(([key, value]) => `"${stringify(key)}": ${stringify(value)}`)
				.join(", ")})`;

		return `{ ${Object.entries(value)
			.map(([key, value]) => `"${key}": ${stringify(value)}`)
			.join(", ")} }`;
	}
	return JSON.stringify(value);
}
