import { platform, tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { mkdir, readFile, writeFile, rm } from "fs/promises";
import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { applyComptimeReplacements, comptimeCompiler } from "../src/api.ts";
import { getTypeInfoReplacements } from "../src/typeInfo.ts";
import { formatPath } from "../src/resolve.ts";

const randId = () => Math.random().toString(36).substring(2, 15);

const dir = join(__dirname, "..");

describe("comptime", () => {
	const cwd = process.cwd();
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

	afterAll(async () => {
		process.chdir(cwd);
		await rm(tempRoot, { recursive: true });
	});

	const file = async (name: string, content: string) => {
		const path = join(temp, name);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content);
		return path;
	};

	const getCompiled = async (name?: string, typeInfo = false) => {
		const tsconfigPath = join(temp, "tsconfig.json");
		const outdir = join(temp, "out");
		if (typeInfo) {
			const replacements = getTypeInfoReplacements({ tsconfigPath });
			await applyComptimeReplacements({ tsconfigPath, outdir }, replacements);
		} else await comptimeCompiler({ tsconfigPath }, outdir);
		if (name) return await readFile(resolve(outdir, name), "utf-8");
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

	it("should resolve identifiers inside accessed functions", async () => {
		await file(
			"foo.ts",
			`
			import { comptime } from "comptime.ts" with { type: "comptime" };
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
			import { x } from "./baz.ts" with { type: "comptime" };
			console.log(x);

			import { comptime, getComptimeContext } from "comptime.ts" with { type: "comptime" };
			import { existsSync, writeFileSync } from "node:fs" with { type: "comptime" };
			
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
			import { x } from "./baz.ts" with { type: "comptime" };
			console.log(x);

			import { comptime, getComptimeContext } from "comptime.ts" with { type: "comptime" };
			import { existsSync, writeFileSync } from "node:fs" with { type: "comptime" };
			
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
			import * as mod from './value_emitter.ts' with { type: 'comptime' };
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
			import { comptime } from "comptime.ts" with { type: "comptime" };
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
			import { comptime } from "comptime.ts" with { type: "comptime" };
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

	it("should emit basic typeInfo", async () => {
		await file(
			"foo.ts",
			`
			import { typeInfo } from "comptime.ts" with { type: "comptime" };
			export const boolInfo = typeInfo<boolean>();
			export const trueInfo = typeInfo<true>();
			export const falseInfo = typeInfo<false>();
			export const numberInfo = typeInfo<number>();
			export const fourInfo = typeInfo<4>();
			export const bigintInfo = typeInfo<bigint>();
			export const bigFourInfo = typeInfo<4n>();
			export const stringInfo = typeInfo<string>();
			export const helloInfo = typeInfo<"hello">();
			export const symbolInfo = typeInfo<symbol>();
			export const nullInfo = typeInfo<null>();
			export const undefinedInfo = typeInfo<undefined>();
			export const anyInfo = typeInfo<any>();
			export const unknownInfo = typeInfo<unknown>();
			export const neverInfo = typeInfo<never>();
			export const voidInfo = typeInfo<void>();
			`,
		);
		// TODO: typeInfo runs should also remove the comptime import
		const expected = `
			import { typeInfo } from "comptime.ts" with { type: "comptime" };
			export const boolInfo = { "type": "boolean" };
			export const trueInfo = { "type": "literal", "value": true };
			export const falseInfo = { "type": "literal", "value": false };
			export const numberInfo = { "type": "number" };
			export const fourInfo = { "type": "literal", "value": 4 };
			export const bigintInfo = { "type": "bigint" };
			export const bigFourInfo = { "type": "literal", "value": 4n };
			export const stringInfo = { "type": "string" };
			export const helloInfo = { "type": "literal", "value": "hello" };
			export const symbolInfo = { "type": "symbol" };
			export const nullInfo = { "type": "null" };
			export const undefinedInfo = { "type": "undefined" };
			export const anyInfo = { "type": "any" };
			export const unknownInfo = { "type": "unknown" };
			export const neverInfo = { "type": "never" };
			export const voidInfo = { "type": "void" };
			`;
		const result = await getCompiled("foo.ts", true);
		expect(result).toEqual(expected);
	});

	it("should emit correct union typeInfo", async () => {
		await file(
			"foo.ts",
			`
			import { typeInfo } from "comptime.ts" with { type: "comptime" };
			export const basicUnion = typeInfo<string | number>();
			export const literalUnion = typeInfo<4 | "hello">();
			export const anyUnion = typeInfo<number | any>();
			export const stringNeverUnion = typeInfo<string | never>();
			`
		);
		// TODO: typeInfo runs should also remove the comptime import
		const expected = `
			import { typeInfo } from "comptime.ts" with { type: "comptime" };
			export const basicUnion = { "type": "union", "members": [{ "type": "string" }, { "type": "number" }] };
			export const literalUnion = { "type": "union", "members": [{ "type": "literal", "value": 4 }, { "type": "literal", "value": "hello" }] };
			export const anyUnion = { "type": "any" };
			export const stringNeverUnion = { "type": "string" };
			`;
		const result = await getCompiled("foo.ts", true);
		expect(result).toEqual(expected);
	});

	it("should emit typeInfo for crazy TypeScript logic", async () => {
		await file(
			"foo.ts",
			`
			import { typeInfo } from "comptime.ts" with { type: "comptime" };
			type UnionToIntersection<U> = (
				U extends any ? (x: U) => void : never
			) extends ((x: infer I) => void) ? I : never;

			export const impossibleInfo = typeInfo<UnionToIntersection<4 | 5>>();
			export const possibleInfo = typeInfo<UnionToIntersection<'foo' | { foo: string }>>();
			`
		);
		// TODO: typeInfo runs should also remove the comptime import
		// TODO: Object literals should be representable
		const expected = `
			import { typeInfo } from "comptime.ts" with { type: "comptime" };
			type UnionToIntersection<U> = (
				U extends any ? (x: U) => void : never
			) extends ((x: infer I) => void) ? I : never;

			export const impossibleInfo = { "type": "never" };
			export const possibleInfo = { "type": "intersection", "members": [{ "type": "literal", "value": "foo" }, { "type": "object", "members": { "foo": { "type": { "type": "string" } } } }] };
			`;
		const result = await getCompiled("foo.ts", true);
		expect(result).toEqual(expected);
	});

	it("should emit typeInfo for enums", async () => {
		await file(
			"foo.ts",
			`
			import { typeInfo } from "comptime.ts" with { type: "comptime" };
			enum Foo {
				Bar,
				Baz
			};
			type Bar = Foo;
			export const enumInfo = typeInfo<Foo>();
			export const indirectEnumInfo = typeInfo<Bar>();

			enum Empty {};

			export const emptyEnumInfo = typeInfo<Empty>();

			enum Baz {
				Qux = "hello",
			};
			export const explicitEnumInfo = typeInfo<Baz>();
			`,
		);
		const expected = `
			import { typeInfo } from "comptime.ts" with { type: "comptime" };
			enum Foo {
				Bar,
				Baz
			};
			type Bar = Foo;
			export const enumInfo = { "type": "enum", "name": "Foo", "values": [{ "name": "Bar", "value": 0 }, { "name": "Baz", "value": 1 }] };
			export const indirectEnumInfo = { "type": "enum", "name": "Foo", "values": [{ "name": "Bar", "value": 0 }, { "name": "Baz", "value": 1 }] };

			enum Empty {};

			export const emptyEnumInfo = { "type": "enum", "name": "Empty", "values": [] };

			enum Baz {
				Qux = "hello",
			};
			export const explicitEnumInfo = { "type": "enum", "name": "Baz", "values": [{ "name": "Qux", "value": "hello" }] };
			`;
		const result = await getCompiled("foo.ts", true);
		expect(result).toEqual(expected);
	});
	it("should emit typeInfo for arrays", async () => {
		await file(
			"foo.ts",
			`
			import { typeInfo } from "comptime.ts" with { type: "comptime" };
			type Foo = string[];
			type Bar = (string | number)[];

			export const fooArrayInfo = typeInfo<Foo>();
			export const barArrayInfo = typeInfo<Bar>();
			`,
		);
		const expected = `
			import { typeInfo } from "comptime.ts" with { type: "comptime" };
			type Foo = string[];
			type Bar = (string | number)[];

			export const fooArrayInfo = { "type": "array", "elementType": { "type": "string" } };
			export const barArrayInfo = { "type": "array", "elementType": { "type": "union", "members": [{ "type": "string" }, { "type": "number" }] } };
			`;
		const result = await getCompiled("foo.ts", true);
		expect(result).toEqual(expected);
	});
	it("should emit typeInfo for tuples", async () => {
		await file(
			"foo.ts",
			`
			import { typeInfo } from "comptime.ts" with { type: "comptime" };
			type Foo = [string, number];

			export const fooTupleInfo = typeInfo<Foo>();
			`,
		);
		const expected = `
			import { typeInfo } from "comptime.ts" with { type: "comptime" };
			type Foo = [string, number];

			export const fooTupleInfo = { "type": "tuple", "members": [{ "type": "string" }, { "type": "number" }] };
			`;
		const result = await getCompiled("foo.ts", true);
		expect(result).toEqual(expected);
	});
	it("should emit typeInfo for object literals", async () => {
		await file(
			"foo.ts",
			`
			import { typeInfo } from "comptime.ts" with { type: "comptime" };
			type Foo = { foo: string, bar: number };

			export const fooObjectInfo = typeInfo<Foo>();
			`,
		);
		const expected = `
			import { typeInfo } from "comptime.ts" with { type: "comptime" };
			type Foo = { foo: string, bar: number };

			export const fooObjectInfo = { "type": "object", "members": { "foo": { "type": { "type": "string" } }, "bar": { "type": { "type": "number" } } } };
			`;
		const result = await getCompiled("foo.ts", true);
		expect(result).toEqual(expected);
	});
});
