// @ts-nocheck

import { typeInfo } from "comptime.ts";

type T = string;

/* typeInfo<5>() */
console.log(typeInfo<5>());

/* typeInfo<"literal string">() */
console.log(typeInfo<"literal string">());

/* typeInfo<5n>() */
console.log(typeInfo<5n>());

/* typeInfo<string>() */
console.log(typeInfo<string>());

/* typeInfo<number>() */
console.log(typeInfo<number>());

/* typeInfo<true>() */
console.log(typeInfo<true>());

/* typeInfo<boolean>() */
console.log(typeInfo<boolean>());

/* typeInfo<"a" | "b">() */
console.log(typeInfo<"a" | "b">());

/* typeInfo<1 | 2 | 3>() */
console.log(typeInfo<1 | 2 | 3>());

/* typeInfo<string | number>() */
console.log(typeInfo<string | number>());

interface Vec {
	x: number;
	y?: number;
}

/* typeInfo<Vec>() */
console.log(typeInfo<Vec>());

/* typeInfo<{ a: string; b: number }>() */
console.log(typeInfo<{ a: string; b: number }>());

/* typeInfo<number[]>() */
console.log(typeInfo<number[]>());

/* typeInfo<string[]>() */
console.log(typeInfo<(string | number)[]>());

console.log(typeInfo<[number, string]>());

type A = readonly [number, string];

console.log(typeInfo<A>());

console.log(typeInfo<readonly [number, string]>());

console.log(typeInfo<readonly [number, string, ...undefined[]]>());
