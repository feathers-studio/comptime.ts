# Errors

([back to home](../))

Errors happen while writing code. And it can be hard to diagnose comptime evaluations, since you don't see the constructed code block that's being executed for each expression. `comptime.ts` attempts to provide as much information as possible to help you debug and fix issues.

![Compile Error](/error.jpg)

The following are known errors that can occur when using comptime.

-   [`CT_ERR_GET_EVALUATION`](#ct_err_get_evaluation)
-   [`CT_ERR_SYNTAX_CHECK`](#ct_err_syntax_check)
-   [`CT_ERR_ERASE_TYPES`](#ct_err_erase_types)
-   [`CT_ERR_CREATE_FUNCTION`](#ct_err_create_function)
-   [`CT_ERR_EVALUATE`](#ct_err_evaluate)
-   [`CT_ERR_NO_COMPTIME`](#ct_err_no_comptime)

---

## CT_ERR_GET_EVALUATION

> Error occurred while attempting to construct the comptime evaluation block.

This error occurs when `comptime.ts` is traversing the source file to reconstruct an evaluation block from the expression that's being evaluated.

### Explanation

Consider this source file:

```typescript
import { sum } from "./sum.ts" with { type: "comptime" };
import { value } from "./value.ts";
const x = 1;
const y = sum(x, value);
```

Here the expression being evaluated is

```typescript
sum(x, value);
```

`comptime.ts` will notice the identifiers and extract additional lines to add to the evaluation block.

```typescript
import { sum } from "./sum.ts" with { type: "comptime" };
import { value } from "./value.ts";
^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~2
const x = 1;
^~~~~~~~~~~1
const y = sum(x, value);
              ^1 ^~~~2
```

Extracted evaluation block:

```typescript
const { value } = await import("./value.ts");
const x = 1;
return sum(x, value);
```

If an error occurs during this process, this error will be thrown.

### Solution

If the printed error message is not helpful, this might be an error in `comptime.ts`. [Raise an issue](https://github.com/feathers-studio/comptime.ts/issues/new/choose) with the full error message and the code that's being evaluated.

If the error persists, try to simplify the comptime expression.

---

## CT_ERR_SYNTAX_CHECK

> Syntax error in comptime evaluation block.

This error occurs when there's a syntax error in the code that's being evaluated at compile time. The error message will include the specific syntax error and its location.

### Broken Code ❌

```typescript
import { sum } from "./bar.ts" with { type: "comptime" };
console.log(sum(1 2 3)); // Missing comma
```

### Solution

Fix the syntax error in expressions that may be included in the evaluation block.

### Fixed Code ✔️

```typescript
import { sum } from "./bar.ts" with { type: "comptime" };
console.log(sum(1, 2, 3)); // Fixed syntax
```

---

## CT_ERR_ERASE_TYPES

> Error occurred while erasing types.

This error occurs when comptime.ts fails to strip TypeScript type information from the evaluation block. `comptime.ts` does no type-checking, so this more likely has to do with syntactical errors.

### Solution

Ensure the evaluation block is syntactically valid and does not contain invalid types.

---

## CT_ERR_CREATE_FUNCTION

> Error occurred while creating a new Function.

This typically happens when the extracted evaluation block contains syntax invalid inside a function.

### Solution

The type-stripped evaluation block should have been printed along with the error. Ensure the context is syntactically valid inside of an async function.

---

## CT_ERR_EVALUATE

> Error occurred while evaluating the expression.

This error implies that an evaluation block was created, but it failed to evaluate at compile time.

It could due to:

-   An error was thrown while evaluating the constructed code block.
-   Logical errors in the comptime expression.
-   A dependency could not be resolved at compile time.

A common cause of this error might be trying to evaluate an expression that cannot resolve all its dependencies at compile time.

### Broken Code ❌

```typescript
import { foo } from "./bar.ts" with { type: "comptime" };

((a) => {
	console.log(foo(a));
})(10);
```

Since `a` is not statically declared at compile time, it gets ignored, and the following construct is created:

```typescript
const { foo } = await import("./bar.ts");
console.log(foo(a));
                ^ ReferenceError: a is not defined
```

### Solution

Fix the underlying error, and ensure all dependencies are available at compile time.

### Fixed Code ✔️

```typescript
import { foo } from "./bar.ts" with { type: "comptime" };

const a = 10;
console.log(foo(a));
```

---

## CT_ERR_NO_COMPTIME

> `comptime()` must be called in a comptime context, but was called at runtime.
>
> Are you missing `with { type: "comptime" }` or a compile-step?

This error occurs when the `comptime()` function is called outside of a comptime context.

This means you either:

-   Imported `comptime` without the `{ type: "comptime" }` attribute.
-   Attempted to run the code without compiling.

### Broken Code ❌

```typescript
import { comptime } from "comptime.ts"; // not imported with { type: "comptime" }
const x = comptime(1 + 2);
```

### Solution

1. Ensure you're importing with the comptime type attribute.
2. Ensure you're compiling the module using one of the [available methods](/#usage).

### Fixed Code ✔️

```typescript
import { comptime } from "comptime.ts" with { type: "comptime" };
const x = comptime(1 + 2); // Now in comptime context
```
