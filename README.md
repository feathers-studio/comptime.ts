<div align="center">
  <img src="https://raw.githubusercontent.com/feathers-studio/comptime.ts/master/docs/comptime.ts.svg" alt="Hyperactive">
</div>

<div align="center">
<h1>⚡️ comptime.ts</h1>
</div>

[![npm version](https://img.shields.io/npm/v/comptime.ts.svg)](https://www.npmjs.com/package/comptime.ts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A dead-simple TypeScript compiler that does one thing really well: enables compile-time evaluation of expressions marked with `comptime`.

This is useful for optimising your code by moving computations from runtime to compile time. This project was inspired by [Bun macros](https://bun.sh/docs/bundler/macros) and [Zig comptime](https://ziglang.org/documentation/master/#Compile-Time-Expressions) (hence the name).

> **Warning**: You are responsible for ensuring that the expressions you mark with `comptime` are safe to evaluate at compile time. `comptime.ts` does not perform any isolation. However, comptime imports are only allowed in project files, and not in node_modules. You may however import from node_modules as comptime.

## Contents

-   [What is comptime.ts?](#what-is-comptime.ts)
-   [Installation](#installation)
-   [Usage](#usage)
-   [Forcing comptime evaluation](#forcing-comptime-evaluation-of-arbitrary-expressions)
-   [How it works](#how-it-works)
-   [Limitations](#limitations)
-   [Best practices](#best-practices)
-   [Troubleshooting](#troubleshooting)
-   [License](#license)

## What is comptime.ts?

comptime.ts allows you to evaluate expressions at compile time, similar to compile-time macros in other languages. This can help optimise your code by moving computations from runtime to compile time.

### Example

```typescript
import { sum } from "./sum.ts" with { type: "comptime" };
import { css } from "./css.ts" with { type: "comptime" };

console.log(sum(1, 2));
console.log(css`
  color: red;
  font-size: 16px;
`);
```

Gets compiled to:

```typescript
import { sum } from "./sum.ts" with { type: "comptime" };
import { css } from "./css.ts" with { type: "comptime" };

console.log(3);
console.log("h8b3f2c");
```

Apart from function calls and tagged template literals, all sorts of expressions are supported, as long as the resultant value is serialisable to JSON.

> **Note**: The import statement remains in the output even though the expression was resolved at compile time. We assume you have other tooling (like Vite) to handle unused import removal.

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

### Command Line Interface

You can also use the CLI:

```bash
npx comptime.ts --project tsconfig.json --outdir out
```

### Without Vite

Use the API directly:

```typescript
import { comptime } from "comptime.ts";

await comptime("tsconfig.json", "./out");
```

## Forcing comptime evaluation of arbitrary expressions

We can abuse the fact that any function imported with the `type: "comptime"` option will be evaluated at compile time.

This library exports a `comptime` function that can be used to force comptime evaluation of an expression. This function is a no-op that simply returns the value it was given.

But as long as you import it with the `type: "comptime"` option, it will be evaluated at compile time, including any expressions it contains.

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

## How it Works

`comptime.ts` works by:

1. Parsing your TypeScript code to find imports marked with `type: "comptime"`
2. Finding all expressions in your files that use these imports
3. Collecting an execution block by walking up the file to find all references used by the comptime expression
4. Evaluating the execution block in an isolated context at compile time
5. Replacing the comptime expression with the result of the execution block

## Limitations

-   Only JSON-serializable values can be returned from comptime expressions
-   The evaluation context is isolated, so certain runtime features might not be available
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

1. **Redundant imports not removed**

    - `comptime.ts` only replaces comptime expressions.
    - It does not remove imports or clean up unused code afterwards.
    - Use other tooling (like Vite) to handle such cleanup after the fact.
    - `comptime.ts` is available as a standalone CLI, JavaScript API and Vite plugin.
    - If you'd like `comptime.ts` to integrate with other tooling, please let us know via an issue or raise a PR!

1. **My comptime expression was not replaced**

    - Check that the import has `{ type: "comptime" }`
    - Ensure the expression is JSON-serializable
    - Verify all dependencies are available at compile time

1. **Build time too slow**

    - Consider moving complex computations to runtime
    - Break down large expressions into smaller ones
    - Use the `include`/`exclude` options to limit scope

## License

MIT
