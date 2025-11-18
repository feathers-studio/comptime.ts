import { sum } from "./producer.ts" with { at: "comptime" };
console.log(sum(1, 2));
