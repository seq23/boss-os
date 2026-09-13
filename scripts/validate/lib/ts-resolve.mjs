/**
 * Let a validator `import()` the worker's own TypeScript, extensionless imports and all.
 *
 * WHY THIS IS HERE. The strongest validators in this repository do not assert something about the
 * source text that looks like the rule — they RUN the shipped function over the rows that caused
 * the defect. Node strips types from a `.ts` file natively, so that already works for a leaf
 * module. It stops at the first extensionless import: `src` is written for a bundler, where
 * `from "./cadence"` is correct and idiomatic, and Node ESM requires the extension.
 *
 * Rewriting the repository's imports to suit a validator would be the tail wagging the dog. This is
 * the handful of lines that make Node resolve the way the bundler does, and NOTHING ELSE — no
 * transpile, no shim, no stub. What the validator runs is the file that ships.
 *
 *   import { registerTsResolve } from "./lib/ts-resolve.mjs";
 *   registerTsResolve();
 *   const mod = await import(`file://${absolutePathToSomething}.ts`);
 */
import { registerHooks } from "node:module";

let registered = false;

export function registerTsResolve() {
  if (registered) return;
  registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context);
      } catch (err) {
        if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier)) {
          for (const ext of [".ts", ".tsx", "/index.ts"]) {
            try { return next(specifier + ext, context); } catch { /* try the next shape */ }
          }
        }
        throw err;
      }
    },
  });
  registered = true;
}
