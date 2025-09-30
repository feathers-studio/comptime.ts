---
title: comptime.ts | serialisation
description: Serialisation types supported by comptime.ts and their usage.
featured-image: https://comptime.js.org/comptime.ts.jpg
out: docs/serialisation.html
---

# Serialisation

comptime.ts supports serialisation of various JavaScript values during compile-time evaluation. This document details which types can be safely serialised and their specific behaviors.

```typescript
const number = comptime(5);
const set = comptime(new Set([1, 2, 3]));
const debug = comptime(process.env.DEBUG ? (x: string) => console.log(x) : () => {});
```

Compiles to:

```typescript
const number = 5;
const set = new Set([1, 2, 3]);
const debug = x => console.log(x);
```

## Supported Types Reference

| Type               | Supported | Example                                                       | Output                                                        | Notes                                                        |
| ------------------ | --------- | ------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| Number             | Yes       | `5`                                                           | `5`                                                           | All numeric types supported                                  |
| String             | Yes       | `"hello"`                                                     | `"hello"`                                                     |                                                              |
| Boolean            | Yes       | `true`                                                        | `true`                                                        |                                                              |
| Null               | Yes       | `null`                                                        | `null`                                                        |                                                              |
| Undefined          | Yes       | `undefined`                                                   | `undefined`                                                   |                                                              |
| BigInt             | Yes       | `5n`                                                          | `5n`                                                          | Large integers supported                                     |
| Set                | Yes       | `new Set([1, 2, 3])`                                          | `new Set([1, 2, 3])`                                          | Preserves Set semantics                                      |
| Map                | Yes       | `new Map([["foo", "bar"]])`                                   | `new Map([["foo", "bar"]])`                                   | Preserves Map semantics                                      |
| Typed Array        | Yes       | `new Uint8Array([1, 2, 3])`                                   | `new Uint8Array([1, 2, 3])`                                   | All TypedArray variants supported                            |
| Object             | Yes       | `{ foo: "bar" }`                                              | `{ foo: "bar" }`                                              | Must be non-cyclic                                           |
| Date               | Yes       | `new Date(2025, 04, 22)`                                      | `new Date(1747852200000)`                                     | Serialised as Unix timestamp in milliseconds                 |
| Regular Expression | Yes       | `/foo/g`, `new RegExp("foo", "g")`                            | `/foo/g`                                                      | Preserved as RegExp literal                                  |
| Promise            | Yes       | `Promise.resolve("hello")`                                    | `"hello"`                                                     | Automatically resolved                                       |
| Function           | Yes       | `() => "hello"`                                               | `() => "hello"`                                               | Closures must be handled carefully [1]                       |
| Class Instance     | Yes       | `new MyClass()`                                               | `{ foo: "bar" }`                                              | Only enumerable own properties are preserved                 |
| Class constructor  | Yes       | `class { static x = 5; constructor() { this.foo = "bar"; } }` | `class { static x = 5; constructor() { this.foo = "bar"; } }` | Closures must be handled carefully [1]                       |
| Symbol             | No        | `Symbol("foo")`                                               | TypeError                                                     | Symbol identity is not transferable from comptime to runtime |

[1] See "Function Serialisation" section below

## Promise Handling

Promises are automatically resolved during serialisation:

```typescript
// This:
const result = comptime(Promise.resolve(42));

// Becomes:
const result = 42;
```

If your expression returns a promise, we recommend wrapping it in the `comptime` function to provide the correct types.

```typescript
import { readFile } from "fs/promises" with { type: "comptime" };
const result = readFile("file.txt", "utf-8"); // inferred as Promise<string>, but is actually a string
```

Since `readFile` is imported as a comptime function, the call is awaited and replaced with the file contents. To correctly type the result, you can use the `comptime` function to wrap the expression.

```typescript
import { readFile } from "fs/promises" with { type: "comptime" };
import { comptime } from "comptime.ts" with { type: "comptime" };
const result = comptime(readFile("file.txt", "utf-8")); // inferred as string
```

This is of course, zero-cost, since the `comptime` call is also compiled away.

## Function Serialisation

Functions are serialised with their source code preserved. However, you must ensure that all values normally accessible in the function's scope are also available after serialisation. The best practice is to always take your function's dependencies as parameters.

Example:

```typescript
const debug = comptime(process.env.DEBUG ? (x: string) => console.log(x) : () => {});

debug("Initialising app...");
```

Compiles to (assuming `process.env.DEBUG` is `true`):

<!-- prettier-ignore -->
```typescript
const debug = (x) => console.log(x);

debug("Initialising app...");
```

## Class Instance Serialisation

Class instances are serialised as plain objects, with some limitations:

1. Only enumerable own properties are preserved
2. Prototype chain is not serialised
3. Methods are not preserved unless explicitly defined as own properties

Example:

```typescript
class MyClass {
	constructor() {
		this.foo = "bar";
	}
	method() {
		/* ... */
	}
}

// This:
const instance = comptime(new MyClass());

// Becomes:
const instance = { foo: "bar" };
```

Conversely, if you try to serialise a Class constructor, `comptime.ts` will serialise it into the class definition.

```typescript
const MyClass = comptime(
	class {
		static x = 5;
		constructor() {
			this.foo = "bar";
		}
	},
);
```

Compiles to:

```typescript
const MyClass = class {
	static x = 5;
	constructor() {
		this.foo = "bar";
	}
};
```

## Best Practices

1. **Avoid Cyclic References**: Ensure objects don't contain circular references
2. **Handle Closures Carefully**: Be explicit about what values functions need access to
3. **Consider Class Serialisation**: Remember that class instances lose their prototype chain
4. **Use Typed Arrays**: For binary data, prefer TypedArrays over regular arrays
5. **Handle Promises**: Remember that promises are automatically resolved

## Common Pitfalls

1. **Symbol Usage**: Don't use Symbols in comptime expressions
2. **Environment Variables**: Don't rely on runtime environment variables
3. **Class Methods**: Remember that class methods are not preserved
4. **Cyclic References**: Watch out for circular references in objects
5. **Closure Scope**: Ensure all required values are available at compile time

## Troubleshooting

If you encounter serialisation issues:

1. Check if the type is supported (refer to the table above)
2. Ensure no cyclic references exist in your objects
3. Verify that all required values are available at compile time
4. For functions, check that all closure values are properly accessible
5. For class instances, verify that you're only using enumerable own properties
