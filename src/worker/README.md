# src/worker

The Boss OS Worker. Entry `index.ts`.

- `index.ts`: the exported `fetch`, `scheduled` and `email` handlers, plus `handleRequest`
  (directly testable). `/api/boss/*`, `/tap/*`, `/p/*` and `/research/*` go to Boss OS
  (`bossMount.ts`, `boss/`), behind Boss OS's own passcode session. `/api/health` is the public
  liveness check. Every other `/api/*` path answers 410 naming West Peek OS, where the retired
  fund API now lives (chassis retirement, 22 Nov 2026). Non-API paths go to `env.ASSETS`.
- `boss/`: Boss OS itself (routes, duties, intake, router, auth).
- `effects/`: the few outside readers Boss OS still uses (browser, search, grounding links, mail parsing).
- `env.ts`: `Env` bindings.

Keep imports relative (wrangler does not resolve tsconfig paths).
