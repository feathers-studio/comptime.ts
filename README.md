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

## License

MIT
