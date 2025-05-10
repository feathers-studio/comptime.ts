import { sum } from "./producer.ts" with { type: "comptime" };
console.log(sum(1, 2));
