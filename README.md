<div align="center">
  <img src="https://raw.githubusercontent.com/feathers-studio/comptime.ts/master/docs/comptime.ts.svg" alt="Hyperactive">
</div>

<div align="center">
<h1>⚡️ comptime.ts</h1>
</div>

<div align="center">
<a href="https://github.com/feathers-studio/comptime.ts" target="_blank">
  <svg height="32" viewBox="0 0 24 24" version="1.1" width="32" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
	<path
		d="M12 1C5.9225 1 1 5.9225 1 12C1 16.8675 4.14875 20.9787 8.52125 22.4362C9.07125 22.5325 9.2775 22.2025 9.2775 21.9137C9.2775 21.6525 9.26375 20.7862 9.26375 19.865C6.5 20.3737 5.785 19.1912 5.565 18.5725C5.44125 18.2562 4.905 17.28 4.4375 17.0187C4.0525 16.8125 3.5025 16.3037 4.42375 16.29C5.29 16.2762 5.90875 17.0875 6.115 17.4175C7.105 19.0812 8.68625 18.6137 9.31875 18.325C9.415 17.61 9.70375 17.1287 10.02 16.8537C7.5725 16.5787 5.015 15.63 5.015 11.4225C5.015 10.2262 5.44125 9.23625 6.1425 8.46625C6.0325 8.19125 5.6475 7.06375 6.2525 5.55125C6.2525 5.55125 7.17375 5.2625 9.2775 6.67875C10.1575 6.43125 11.0925 6.3075 12.0275 6.3075C12.9625 6.3075 13.8975 6.43125 14.7775 6.67875C16.8813 5.24875 17.8025 5.55125 17.8025 5.55125C18.4075 7.06375 18.0225 8.19125 17.9125 8.46625C18.6138 9.23625 19.04 10.2125 19.04 11.4225C19.04 15.6437 16.4688 16.5787 14.0213 16.8537C14.42 17.1975 14.7638 17.8575 14.7638 18.8887C14.7638 20.36 14.75 21.5425 14.75 21.9137C14.75 22.2025 14.9563 22.5462 15.5063 22.4362C19.8513 20.9787 23 16.8537 23 12C23 5.9225 18.0775 1 12 1Z">
	</path>
</svg>
</a>
</div>

A dead-simple TypeScript compiler that does one thing really well: enables compile-time evaluation of expressions marked with `comptime`.

This is useful for optimising your code by moving computations from runtime to compile time. This project was inspired by [Bun macros](https://bun.sh/docs/bundler/macros) and [Zig comptime](https://ziglang.org/documentation/master/#Compile-Time-Expressions) (hence the name).

> **Warning**: You are responsible for ensuring that the expressions you mark with `comptime` are safe to evaluate at compile time. `comptime.ts` does not perform any isolation. However, comptime imports are only allowed in project files, and not in node_modules. You may however import from node_modules as comptime.

### [↗️ Quick Error Reference](./ERRORS.md)

## Contents

-   [What is comptime.ts?](#what-is-comptimets)
-   [Examples](#examples)
    -   [1. Simple sum function](#1-simple-sum-function)
    -   [2. Turn emotion CSS into a zero-runtime CSS library](#2-turn-emotion-css-into-a-zero-runtime-css-library)
    -   [3. Calculate constants at compile time](#3-calculate-constants-at-compile-time)
-   [Installation](#installation)
-   [Usage](#usage)
    -   [With Vite](#with-vite)
    -   [With Bun bundler](#with-bun-bundler)
    -   [Command Line Interface](#command-line-interface)
    -   [Via API](#via-api)
-   [Forcing comptime evaluation](#forcing-comptime-evaluation-of-arbitrary-expressions-and-resolving-promises)
    -   [Resolving promises](#resolving-promises)
    -   [Opting out of comptime virality](#opting-out-of-comptime-virality)
-   [How it works](#how-it-works)
-   [Limitations](#limitations)
-   [Best practices](#best-practices)
-   [Troubleshooting](#troubleshooting)
-   [Supporting the project](#supporting-the-project)
-   [License](#license)

## What is comptime.ts?

comptime.ts allows you to evaluate expressions at compile time, similar to compile-time macros in other languages. This can help optimise your code by moving computations from runtime to compile time.

## Examples

### 1. Simple sum function

```typescript
import { sum } from "./sum.ts" with { type: "comptime" };

console.log(sum(1, 2));
```

Compiles to:

```typescript
console.log(3);
```

### 2. Turn emotion CSS into a zero-runtime CSS library

```typescript
import { css } from "@emotion/css" with { type: "comptime" };

const style = css`
  color: red;
  font-size: 16px;
`;

div({ class: style });
```

Compiles to:

```typescript
const style = "css-x2wxma";
div({ class: style });
```

> **Note**: The `@emotion/css` import got removed from the output. You'll need to somehow add the styles back to your project, for example by side-effect loading the component files that originally called <code>css``</code> and extracting the styles with`getRegisteredStyles()`from`@emotion/css`.

### 3. Calculate constants at compile time

```typescript
import { ms } from "ms" with { type: "comptime" };

const HOUR = ms("1 hour");
```

Compiles to:

```typescript
const HOUR = 3600000;
```

Apart from function calls and tagged template literals, all sorts of expressions are supported (even complex ones like index access and simple ones like imported constants). The only limitation is that the resultant value must be serialisable to JSON.

> **Note**: The import statements marked with `type: "comptime"` are removed in the output. We assume you have other tooling (like Vite) to handle other unused redundant statements left behind after comptime evaluation.

## Installation

```bash
bun add comptime.ts

# or

pnpm add comptime.ts

# or

npm install comptime.ts
```

## Usage

### With Vite

Add the plugin to your Vite configuration:

```typescript
import { comptime } from "comptime.ts/vite";

export default defineConfig({
	build: {
		rollupOptions: {
			plugins: [comptime()],
		},
	},
});
```

> **Note**: We recommend only enabling this in production builds because it will increase build time.

### With Bun bundler

Add the plugin to your Bun bundler configuration:

```typescript
import { comptime } from "comptime.ts/bun";

await Bun.build({
	entrypoints: ["./index.ts"],
	outdir: "./out",
	plugins: [comptime()],
});
```

### Command Line Interface

You can also use the CLI:

```bash
npx comptime.ts --project tsconfig.json --outdir out
```

Or use Bun if you prefer:

```bash
bunx --bun comptime.ts --project tsconfig.json --outdir out
```

### Via API

Use the API directly:

```typescript
import { comptimeCompiler } from "comptime.ts";

await comptimeCompiler({ tsconfigPath: "tsconfig.json" }, "./out");
```

## Forcing comptime evaluation of arbitrary expressions (and resolving promises)

We can abuse the fact that any function imported with the `type: "comptime"` option will be evaluated at compile time.

This library exports a `comptime()` function that can be used to force comptime evaluation of an expression. It has to be imported with the `"comptime"` attribute. Any expressions contained within it will be evaluated at compile time. If the result is a promise, the resolved value will be inlined.

> **Note**: Technically the `comptime()` function by itself doesn't do anything by itself. It's an identity function. It's the `with { type: "comptime" }` attribute that makes the compiler evaluate the expression at compile time.

```ts
import { comptime } from "comptime.ts" with { type: "comptime" };
```

Use it to force comptime evaluation of an expression.

```ts
const x = comptime(1 + 2);
```

When the compiler is run, the expression will be evaluated at compile time.

```ts
const x = 3;
```

### Resolving promises

```ts
const x = comptime(Promise.resolve(1 + 2));
```

When the compiler is run, the promise will be resolved and the result will be inlined at compile time.

```ts
const x = 3;
```

> **Note**: The compiler always resolves promises returned by the evaluation, but this might not reflect in your types, in which case it's useful to use the `comptime()` function to infer the correct type.

### Opting out of comptime virality

Normally, `comptime.ts` will eagerly extend comptime to expressions that include a comptime expression.

```ts
import { foo } from "./foo.ts" with { type: "comptime" };

const x = foo().bar[1];
```

Compiles to:

```ts
const x = 2;
```

Notice how the whole expression, `foo().bar[1]`, is evaluated at compile time. You can opt-out of this behaviour by wrapping your expression in parentheses.

<!-- prettier-ignore -->
```ts
const x = (foo().bar)[1];
```

Compiles to:

<!-- prettier-ignore -->
```ts
const x = ([1, 2])[1];
```

In this case, `foo().bar` is evaluated at runtime, but `[1]` is left untouched.

> **Note**: Your formatter might remove the extraneous parentheses, so you may need to ignore the line (such as with `prettier-ignore` comments). You are of course free to extract the expression to its own line:
>
> ```ts
> const res = foo().bar;
> const x = res[1];
> ```
>
> Compiles to:
>
> ```ts
> const res = [1, 2];
> const x = res[1];
> ```
>
> This also results in only `foo().bar` being evaluated at comptime, and doesn't upset your formatter.

## How it Works

`comptime.ts` works by:

1. Parsing your TypeScript code to find imports marked with `type: "comptime"`
2. Finding all expressions in your files that use these imports
3. Collecting an execution block by walking up the file to find all references used by the comptime expression
4. Evaluating the execution block in an isolated context at compile time
5. Replacing the comptime expression with the result of the execution block

## Limitations

-   Only JSON-serialisable values can be returned from comptime expressions
-   The evaluation block is isolated, so certain runtime features might not be available
-   Complex expressions might increase build time significantly
-   Type information is not available during evaluation

## Best Practices

-   Use comptime for:
    -   Computing constant values
    -   Generating static content
    -   Optimising performance-critical code
-   Avoid using comptime for:
    -   Complex runtime logic
    -   Side effects
    -   Non-deterministic operations

## Troubleshooting

`comptime.ts` will attempt to print very detailed error messages when it runs into an error. The message by itself should provide enough information to resolve the issue. See the [error reference](./ERRORS.md) for more details.

If the error message is not helpful, [raise an issue](https://github.com/feathers-studio/comptime.ts/issues/new/choose) with the full error message and the code that's being evaluated.

However, sometimes `comptime.ts` runs successfully, but the output is not what you expected. This section describes some common issues and how to resolve them.

> **Note**: To force `comptime.ts` to print the constructed evaluation block for each expression and other debug logs, set the environment variable `DEBUG=comptime:*`.

The following are some non-error issues that you might encounter:

1. **Redundant code not removed**

    - `comptime.ts` removes imports marked with `type: "comptime"` and replaces comptime expressions.
    - However, it does not remove other redundant code that might be left behind after compilation.
    - Use other tooling (like Vite) to handle such cleanup after the fact.
    - `comptime.ts` is available as a standalone CLI, JavaScript API and Vite plugin. If you'd like `comptime.ts` to integrate with other tooling, please let us know via an issue or raise a PR!

1. **Compilation result is unexpected**

    - Notice that variables in the caller's scope that are not comptime (imported with the "comptime" attribute) are not guaranteed to be stable.
    - `comptime.ts` will extract their declarations, but it will not account for mutations.
    - If multiple comptime expressions exist in the same file, all dependent statements will be extracted and evaluated for _each_ expression. This may cause the same declarations to be evaluated multiple times, and mutations are not reflected between evaluations.
    - If you want a mutable comptime variable, declare it in another file and import it with the "comptime" attribute.

    ```typescript
    import { sum } from "./sum.ts" with { type: "comptime" };

    let a = 1;

    const x = sum(++a, 2);
    ++a;
    const y = sum(++a, 2);
    ```

    Compiles to:

    ```typescript
    let a = 1; // not a comptime var

    const x = 4;
    ++a; // untouched
    const y = 4; // same as previous line because it was evaluated independently
    ```

    However, if we move the mutable state to another file, mutations are reflected between evaluations.

    ```typescript
    import { sum } from "./sum.ts" with { type: "comptime" };

    // export const state = { a: 1 };
    import { state } from "./state.ts" with { type: "comptime" };

    const x = sum(++state.a, 2);
    ++state.a;
    const y = sum(state.a, 2);
    ```

    Compiles to:

    ```typescript
    const x = 4;
    3; // because of the ++a in previous line
    const y = 5;
    ```

1. **My comptime expression was not replaced**

    - Check that the import has `{ type: "comptime" }`.
    - Ensure the expression is JSON-serialisable.
    - Verify all dependencies are available at compile time.

1. **Build time too slow**

    - Consider moving complex computations to runtime.
    - Break down large expressions into smaller ones.
    - Pass `include`/`exclude` options to limit scope.

## Supporting the project

A lot of time and effort goes into maintaining projects like this.

If you'd like to support the project, please consider:

-   [Star and share the project with others](https://github.com/feathers-studio/comptime.ts)
-   Sponsor the project ([GitHub Sponsors](https://github.com/sponsors/MKRhere) / [Patreon](https://patreon.com/MKRhere) / [Ko-fi](https://ko-fi.com/MKRhere))

## License

MIT
