import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { mkdir, readFile, writeFile, rm } from "fs/promises";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { comptimeCompiler } from "../src/index.ts";

const randId = () => Math.random().toString(36).substring(2, 15);

describe("comptime", () => {
	let temp: string;

	beforeEach(async () => {
		temp = join(tmpdir(), randId());
		await mkdir(temp, { recursive: true });
		process.chdir(temp);
		await writeFile(join(temp, "package.json"), `{"name": "test", "version": "1.0.0", "type": "module"}`);
		await writeFile(
			join(temp, "tsconfig.json"),
			`
			{
				"compilerOptions": {
					"target": "ESNext",
					"module": "ESNext",
					"moduleResolution": "bundler",
					"outDir": "./out"
				},
				"include": ["./**/*.ts"],
				"exclude": ["exclude/**"]
			}
			`,
		);
	});

	afterEach(async () => {
		await rm(temp, { recursive: true });
	});

	const file = async (name: string, content: string) => {
		const path = join(temp, name);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content);
		return path;
	};

	const getCompiled = async (name: string) => {
		const tsconfigPath = join(temp, "tsconfig.json");
		const outdir = join(temp, "out");
		await comptimeCompiler({ tsconfigPath }, outdir);
		return await readFile(resolve(outdir, name), "utf-8");
	};

	it("should work", async () => {
		await file(
			"foo.ts",
			`
				import { sum } from "./bar.ts" with { type: "comptime" };
				console.log(sum(1, 2));
			`,
		);
		await file(
			"bar.ts",
			`
				export function sum(a: number, b: number) { return a + b; }
			`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
				
				console.log(3);
			`;

		return expect(result).toEqual(expected);
	});

	it("should handle multiple comptime imports from different files", async () => {
		await file(
			"foo.ts",
			`
			import { sum } from "./bar.ts" with { type: "comptime" };
			import { mul } from "./baz.ts" with { type: "comptime" };
			console.log(sum(1, 2) + mul(2, 3));
		`,
		);
		await file(
			"bar.ts",
			`
			export function sum(a: number, b: number) { return a + b; }
		`,
		);
		await file(
			"baz.ts",
			`
			export function mul(a: number, b: number) { return a * b; }
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			
			console.log(3 + 6);
		`;
		return expect(result).toEqual(expected);
	});

	it("should work with nested directories", async () => {
		await mkdir(join(temp, "nested"), { recursive: true });
		await file(
			"foo.ts",
			`
			import { sub } from "./nested/bar.ts" with { type: "comptime" };
			console.log(sub(5, 3));
		`,
		);
		await file(
			"nested/bar.ts",
			`
			export function sub(a: number, b: number) { return a - b; }
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			console.log(2);
		`;
		return expect(result).toEqual(expected);
	});

	it("should leave files unchanged if there are no comptime imports", async () => {
		await file(
			"foo.ts",
			`
			console.log('no comptime here');
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			console.log('no comptime here');
		`;
		return expect(result).toEqual(expected);
	});

	it("should replace simple identifiers", async () => {
		await file(
			"foo.ts",
			`
			import { x } from "./bar.ts" with { type: "comptime" };
			console.log(x);
			`,
		);
		await file(
			"bar.ts",
			`
			export const x = 1 + 1;
			`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			console.log(2);
			`;
		return expect(result).toEqual(expected);
	});

	it("should ignore type-only imports for comptime", async () => {
		await file(
			"foo.ts",
			`
			import type { Foo } from "./types.ts";
			const x: Foo = { a: 1 };
		`,
		);
		await file(
			"types.ts",
			`
			import type { Foo } from "./types.ts";
			export type Foo = { a: number };
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			import type { Foo } from "./types.ts";
			const x: Foo = { a: 1 };
		`;
		return expect(result).toEqual(expected);
	});

	it("should handle syntax errors gracefully", async () => {
		await file(
			"foo.ts",
			`
			import { sum } from "./bar.ts" with { type: "comptime" };
			console.log(sum(1 2 3)); // missing comma
		`,
		);
		await file(
			"bar.ts",
			`
			export function sum(a: number, b: number) { return a + b; }
		`,
		);
		// await getCompiled("foo.ts");
		return expect(getCompiled("foo.ts")).rejects.toThrow();
	});

	it("should ignore non-TS files in the directory", async () => {
		await file(
			"foo.ts",
			`
			console.log('hello');
		`,
		);
		await file("notats.txt", `this is not a ts file`);

		const result = await getCompiled("foo.ts");
		const expected = `
			console.log('hello');
		`;
		return expect(result).toEqual(expected);
	});

	it("should handle complex comptime expressions", async () => {
		await file(
			"foo.ts",
			`
			import { o } from "./bar.ts" with { type: "comptime" };
			console.log(o.foo + o.bar.baz + o.bar.qux.reduce((a, b) => a + b, 0));
		`,
		);
		await file(
			"bar.ts",
			`
			export const o = {
				foo: 1,
				bar: {
					baz: 2,
					qux: [3, 4, 5],
				},
			};
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			console.log(1 + 2 + 12);
		`;
		return expect(result).toEqual(expected);
	});

	it("should stop at parenthesised boundaries", async () => {
		await file(
			"foo.ts",
			`
			import { o } from "./bar.ts" with { type: "comptime" };
			console.log((o.foo).toString());
		`,
		);
		await file(
			"bar.ts",
			`
			export const o = {
				foo: 1,
				bar: {
					baz: 2,
				},
			};
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			console.log((1).toString());
		`;
		return expect(result).toEqual(expected);
	});

	it("should replace void identifiers with undefined", async () => {
		await file(
			"foo.ts",
			`
			import { x } from "./bar.ts" with { type: "comptime" };
			console.log(x);
		`,
		);
		await file(
			"bar.ts",
			`
			export const x = void 0;
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			console.log(undefined);
		`;
		return expect(result).toEqual(expected);
	});

	it("should replace void expressions with undefined", async () => {
		await file(
			"foo.ts",
			`
			import { console } from "./console.ts" with { type: "comptime" };
			console.log(5);
		`,
		);
		await file(
			"console.ts",
			`
			export const console = {
				log: (x: unknown) => {},
			};
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			undefined;
		`;
		return expect(result).toEqual(expected);
	});

	it("should replace unsubstituted tagged template literals with resolved values", async () => {
		await file(
			"foo.ts",
			`
			import { t } from "./bar.ts" with { type: "comptime" };
			console.log(t\`hello\`);
		`,
		);
		await file(
			"bar.ts",
			`
			export const t = (xs: string[]) => xs.join("");
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			console.log("hello");
		`;
		return expect(result).toEqual(expected);
	});

	it("should replace substituted tagged template literals with resolved values", async () => {
		await file(
			"foo.ts",
			`
			import { t } from "./bar.ts" with { type: "comptime" };
			console.log(t\`hello ${5}!\`);
		`,
		);
		await file(
			"bar.ts",
			`
			export const t = (xs: TemplateStringsArray, ...ys: number[]) => String.raw(xs, ...ys);
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			console.log("hello 5!");
		`;
		return expect(result).toEqual(expected);
	});

	it("should force comptime evaluation of an expression", async () => {
		await file("node_modules/comptime.ts/index.js", `export const comptime = x => x;`);
		await file(
			"foo.ts",
			`
			import { comptime } from "comptime.ts" with { type: "comptime" };
			const x = comptime(1 + 2);
			console.log(x);
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			const x = 3;
			console.log(x);
		`;
		return expect(result).toEqual(expected);
	});

	it("should force comptime evaluation of a complex expression", async () => {
		await file("node_modules/comptime.ts/index.js", `export const comptime = x => x;`);
		await file(
			"foo.ts",
			`
			import { comptime } from "comptime.ts" with { type: "comptime" };
			import { o } from "./bar.ts" with { type: "comptime" };
			console.log(comptime(o.foo + o.bar.baz + o.bar.qux.reduce((a, b) => a + b, 0)));
		`,
		);
		await file(
			"bar.ts",
			`
			export const o = {
				foo: 1,
				bar: {
					baz: 2,
					qux: [3, 4, 5],
				},
			};
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			
			console.log(15);
		`;
		return expect(result).toEqual(expected);
	});

	it("should evaluate asynchronous expressions", async () => {
		await file("node_modules/comptime.ts/index.js", `export const comptime = x => x;`);
		await file(
			"foo.ts",
			`
			import { comptime } from "comptime.ts" with { type: "comptime" };
			const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
			const x = comptime(await sleep(1000).then(() => 1 + 2));
			console.log(x);
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
			const x = 3;
			console.log(x);
		`;
		return expect(result).toEqual(expected);
	});

	it("should handle different import types", async () => {
		await file(
			"foo.ts",
			`
			import { x } from "./bar.ts" with { type: "comptime" };
			import * as bar from "./bar.ts" with { type: "comptime" };
			import defaultBar from "./bar.ts" with { type: "comptime" };
			import { x as y } from "./bar.ts" with { type: "comptime" };
			console.log(x, bar.x, defaultBar, y);
		`,
		);
		await file(
			"bar.ts",
			`
			export const x = 1;
			export default 2;
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			
			
			
			console.log(1, 1, 2, 1);
		`;
		return expect(result).toEqual(expected);
	});

	it("should work even if some statements are export declarations", async () => {
		await file("node_modules/comptime.ts/index.js", `export const comptime = x => x;`);
		await file(
			"foo.ts",
			`
			import { comptime } from "comptime.ts" with { type: "comptime" };
			export const y = 2;
			console.log(comptime(y + y));
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			export const y = 2;
			console.log(4);
		`;
		return expect(result).toEqual(expected);
	});

	it("should import comptime from node_modules", async () => {
		await file(
			"foo.ts",
			`
			import { x } from "bar" with { type: "comptime" };
			console.log(x);
		`,
		);
		await file(
			"node_modules/bar/package.json",
			`{"name": "bar", "version": "1.0.0", "main": "index.js", "type": "module"}`,
		);
		await file("node_modules/bar/index.js", `export const x = 2;`);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			console.log(2);
		`;
		return expect(result).toEqual(expected);
	});

	it("should not allow comptime imports from node_modules", async () => {
		await file(
			"foo.ts",
			`
			import { x } from "bar";
			console.log(x);
		`,
		);
		await file(
			"node_modules/bar/package.json",
			`{"name": "bar", "version": "1.0.0", "main": "index.js", "type": "module"}`,
		);
		await file(
			"node_modules/bar/index.js",
			`
			import { x } from "baz" with { type: "comptime" };
			console.log(x);
		`,
		);
		await file(
			"node_modules/baz/package.json",
			`{"name": "baz", "version": "1.0.0", "main": "index.js", "type": "module"}`,
		);
		await file("node_modules/baz/index.js", `export const x = 2;`);

		return expect(getCompiled("node_modules/bar/index.js")).rejects.toThrow();
	});

	it("should refuse to evaluate comptime() outside of a comptime context", async () => {
		const parent = import.meta.resolve("../src/index.ts");
		const filename = await file("foo.ts", `import { comptime } from "${parent}"; const x = comptime(1 + 2);`);
		// await import(filename);
		// import the file, causing the comptime() call to be performed at runtime outside of a comptime context
		return expect(import(filename)).rejects.toThrow();
	});

	it("should import javascript file from node_modules instead of d.ts", async () => {
		await file(
			"foo.ts",
			`
			import { x } from "bar" with { type: "comptime" };
			console.log(x);
		`,
		);
		await file(
			"node_modules/bar/package.json",
			`{"name": "bar", "version": "1.0.0", "main": "index.js", "types": "index.d.ts"}`,
		);
		await file(
			"node_modules/bar/index.js",
			`
			module.exports = { x: 2 };
		`,
		);
		await file(
			"node_modules/bar/index.d.ts",
			`
			export const x: number;
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			console.log(2);
		`;
		return expect(result).toEqual(expected);
	});
});
