import { platform, tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { comptimeCompiler } from "../src/api.ts";
import { formatPath } from "../src/resolve.ts";

const randId = () => Math.random().toString(36).substring(2, 15);

const dir = join(__dirname, "..");

describe("comptime", () => {
	const tempRoot = join(tmpdir(), "comptime-test");
	let temp: string;

	beforeEach(async () => {
		temp = join(tempRoot, randId());
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

		await file("node_modules/comptime.ts/index.js", `export * from "${formatPath(join(dir, "src/index.ts"))}";`);
	});

	afterAll(async () => await rm(tempRoot, { recursive: true }));

	const file = async (name: string, content: string) => {
		const path = join(temp, name);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content);
		return path;
	};

	const getCompiled = async (name?: string) => {
		const tsconfigPath = join(temp, "tsconfig.json");
		const outdir = join(temp, "out");
		await comptimeCompiler({ tsconfigPath }, outdir);
		if (name) return await readFile(resolve(outdir, name), "utf-8");
	};

	it("should work", async () => {
		await file(
			"foo.ts",
			`
				import { sum } from "./bar.ts" with { at: "comptime" };
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
			import { sum } from "./bar.ts" with { at: "comptime" };
			import { mul } from "./baz.ts" with { at: "comptime" };
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
			import { sub } from "./nested/bar.ts" with { at: "comptime" };
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
			import { x } from "./bar.ts" with { at: "comptime" };
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
			import { sum } from "./bar.ts" with { at: "comptime" };
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
			import { o } from "./bar.ts" with { at: "comptime" };
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
			import { o } from "./bar.ts" with { at: "comptime" };
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
			import { x } from "./bar.ts" with { at: "comptime" };
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
			import { console } from "./console.ts" with { at: "comptime" };
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
			import { t } from "./bar.ts" with { at: "comptime" };
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
			import { t } from "./bar.ts" with { at: "comptime" };
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
		await file(
			"foo.ts",
			`
			import { comptime } from "comptime.ts" with { at: "comptime" };
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
		await file(
			"foo.ts",
			`
			import { comptime } from "comptime.ts" with { at: "comptime" };
			import { o } from "./bar.ts" with { at: "comptime" };
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
		await file(
			"foo.ts",
			`
			import { comptime } from "comptime.ts" with { at: "comptime" };
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
			import { x } from "./bar.ts" with { at: "comptime" };
			import * as bar from "./bar.ts" with { at: "comptime" };
			import defaultBar from "./bar.ts" with { at: "comptime" };
			import { x as y } from "./bar.ts" with { at: "comptime" };
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
		await file(
			"foo.ts",
			`
			import { comptime } from "comptime.ts" with { at: "comptime" };
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
			import { x } from "bar" with { at: "comptime" };
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
			import { x } from "baz" with { at: "comptime" };
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
			import { x } from "bar" with { at: "comptime" };
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

	it("should resolve identifiers inside accessed functions", async () => {
		await file(
			"foo.ts",
			`
			import { comptime } from "comptime.ts" with { at: "comptime" };
			const x = 2;
			function foo(y: number) {
				return x + y;
			}
			console.log(comptime(foo(1)));
		`,
		);

		const result = await getCompiled("foo.ts");
		const expected = `
			
			const x = 2;
			function foo(y: number) {
				return x + y;
			}
			console.log(3);
		`;
		return expect(result).toEqual(expected);
	});
	it("should defer functions to be executed after comptime evaluation", async () => {
		const fooname = await file(
			"foo.ts",
			`
			import { x } from "./baz.ts" with { at: "comptime" };
			console.log(x);

			import { comptime, getComptimeContext } from "comptime.ts" with { at: "comptime" };
			import { existsSync, writeFileSync } from "node:fs" with { at: "comptime" };
			
			if (existsSync("foo.txt")) throw new Error("foo.txt should not exist yet");
			if (existsSync("bar.txt")) throw new Error("bar.txt should not exist yet");
			comptime.defer(() => {
				const context = getComptimeContext();
				writeFileSync("foo.txt", context.sourceFile);
			});
		`,
		);
		const barname = await file(
			"bar.ts",
			`
			import { x } from "./baz.ts" with { at: "comptime" };
			console.log(x);

			import { comptime, getComptimeContext } from "comptime.ts" with { at: "comptime" };
			import { existsSync, writeFileSync } from "node:fs" with { at: "comptime" };
			
			if (existsSync("foo.txt")) throw new Error("foo.txt should not exist yet");
			if (existsSync("bar.txt")) throw new Error("bar.txt should not exist yet");
			comptime.defer(() => {
				const context = getComptimeContext();
				writeFileSync("bar.txt", context.sourceFile);
			});
		`,
		);
		await file(
			"baz.ts",
			`
			export const x = 2;
		`,
		);

		await getCompiled();
		const foo = await readFile(join(dirname(fooname), "foo.txt"), "utf-8");
		const bar = await readFile(join(dirname(fooname), "bar.txt"), "utf-8");
		if (platform() === "win32") {
			// TODO(Thomas): Investigate this inconsistency:
			// context.sourceFile (TypeScript?) gives paths of the form C:/Users/...
			// but everything else uses C:\Users\...
			expect(foo.replaceAll("/", "\\")).toEqual(fooname);
			expect(bar.replaceAll("/", "\\")).toEqual(barname);
		} else {
			expect(foo).toEqual(fooname);
			expect(bar).toEqual(barname);
		}
	});

	it("should format emitted values correctly", async () => {
		await file(
			"value_emitter.ts",
			`
			export const a = null;
			export const b = undefined;
			export const c = true;
			export const d = false;
			export const e = 42;
			export const f = Infinity;
			export const g = -Infinity;
			export const h = NaN;
			export const i = 42n;
			export const j = 'hello';
			export const k = [1, true, null, undefined, 'hello', 42n];
			export const l = new Date(0);
			export const m = new Set();
			m.add(42);
			export const n = new Map();
			n.set('foo', 'bar');
			export const o = new Uint8Array([1,2,3]);
			export const p = { foo: 'bar', baz: 42n };
		`,
		);
		await file(
			"importer.ts",
			`
			import * as mod from './value_emitter.ts' with { at: 'comptime' };
			export const obj = mod;
		`,
		);
		const expected = `
			
			export const obj = ({"a": null, "b": undefined, "c": true, "d": false, "e": 42, "f": Infinity, "g": -Infinity, "h": NaN, "i": 42n, "j": "hello", "k": [1, true, null, undefined, "hello", 42n], "l": new Date(0), "m": new Set([42]), "n": new Map([["foo", "bar"]]), "o": new Uint8Array([1, 2, 3]), "p": ({"foo": "bar", "baz": 42n})});
		`;
		const result = await getCompiled("importer.ts");
		expect(result).toEqual(expected);
	});

	it("should serialise functions to their definition", async () => {
		await file(
			"foo.ts",
			`
			import { comptime } from "comptime.ts" with { at: "comptime" };
			const env = { DEBUG: "true" };
			export const fn = comptime(env.DEBUG ? () => 1 + 2 : () => {});
		`,
		);
		const expected = `
			
			const env = { DEBUG: "true" };
			export const fn = () => 1 + 2;
		`;
		const result = await getCompiled("foo.ts");
		expect(result).toEqual(expected);
	});

	it("should serialise classes to their definition", async () => {
		await file(
			"foo.ts",
			`
			import { comptime } from "comptime.ts" with { at: "comptime" };
			export const MyClass = comptime(class {
				static x = 5;
				constructor() {
					this.foo = "bar";
				}
			});
		`,
		);
		const expected = `
			
			export const MyClass = class {
        static x = 5;
        constructor() {
            this.foo = "bar";
        }
    };
		`;
		const result = await getCompiled("foo.ts");
		expect(result).toEqual(expected);
	});
});
