import { describe, it, expect } from "bun:test";
import { resolve } from "node:path";

import { getComptimeReplacements, applyComptimeReplacements } from "../src/comptime.ts";

const expected = `import { sum } from "./producer.ts" with { type: "comptime" };
console.log(3);
`;

describe("comptime", () => {
	it("should work", async () => {
		const tsconfigPath = resolve(__dirname, "tsconfig.json");
		const outdir = resolve(__dirname, "out");
		const replacements = await getComptimeReplacements({ tsconfigPath });
		await applyComptimeReplacements({ tsconfigPath, outdir }, replacements);

		const result = await Bun.file(resolve(outdir, "consumer.ts")).text();
		expect(result).toEqual(expected);
	});
});
