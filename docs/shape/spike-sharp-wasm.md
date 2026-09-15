# Spike verdict — sharp 0.35 WASM on workerd

> Phase: Stage 0 de-risking spike. Verdict: **PASS — server-side re-encode is viable.**
> Test: `packages/api/src/__tests__/worker/sharp-wasm.spike.test.ts` (runs in a real
> workerd isolate via `@cloudflare/vitest-pool-workers`; project `workers` in
> `vitest.config.mts`).

## What was proven (2026-08-11, all green)

1. **`await import('sharp')` works inside a workerd isolate** with
   `compatibility_flags: ["nodejs_compat"]` (no static import needed).
2. **EXIF-carrying JPEG → clean WebP re-encode works**: a JPEG built with EXIF
   (Copyright/Software) re-encodes to WebP q84 with **no EXIF segment** in the
   output — the whole metadata block (including GPS) is dropped, which is the
   privacy property the sanitize job needs.
3. **`limitInputPixels` is enforced**: a 64×64 input (4096 px) decoded with
   `limitInputPixels: 1000` rejects with a pixel-limit error → the dimension/
   decompression-bomb cap mechanism works under WASM.

## Setup that made it work (Tsuki's proven pattern, unchanged)

- `sharp` pinned **exactly `0.35.3`** in `packages/api/package.json`.
- `@img/sharp-wasm32@^0.35.3` installed **explicitly** as a devDependency.
  Under workerd, sharp's `dist/sharp.cjs` platform resolution falls through to
  `@img/sharp-freebsd-wasm32` (bundled with sharp) and finally
  `@img/sharp-wasm32/sharp.node` — having it in `node_modules` guarantees the
  fallback resolves.
- Dynamic import (`const { default: sharp } = await import('sharp')`), never
  a top-level static import (avoids eager native-module resolution at bundle
  time).
- Workerd pool: `compatibilityDate 2026-02-28` + `nodejs_compat`.

## Test-runner notes

- `@cloudflare/vitest-pool-workers@0.21.0` requires **Vitest 4** (peer
  `vitest ^4.1.0` — repo has 4.1.7).
- Vitest 4 moved custom pools: pass the pool **runner object**
  (`cloudflarePool({ singleWorker: true, miniflare: {...} })`) as the
  project's `pool` option — a bare name string is no longer resolved.
- The root config had to become `vitest.config.mts` so Vite bundles it as ESM
  (the pool package is ESM-only; root `package.json` has no `"type": "module"`).

## Fallback (documented, not needed)

If a future worker hits sharp regression on workerd: keep the client baseline
(`exif: false` in the picker) + magic-byte verification server-side, defer
server re-encode, and treat Cloudflare Images as the paid alternative. The
spike result means Stage 10 can build `media.sanitize` on server re-encode
with caps (`limitInputPixels: 268_402_689`, ≤16384 dimensions, WebP q84
display + bounded thumb, animated-frame cap, m4a verify-only pass-through).
