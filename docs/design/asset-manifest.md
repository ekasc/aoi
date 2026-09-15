# Aoi asset manifest (visual-identity close-out)

Authoritative inventory and art direction for Aoi's Editorial Paper visual
assets. This revision reconciles the manifest with what actually ships:
every entry below was verified against the bundle. Statuses: `shipped` ·
`code-native` (deliberate typographic/geometric treatment, no art file) ·
`removed` (v1 scope decision, not a TODO) · `policy` (rule, no files).

No generative filler was added for this revision. Anything marked
`removed` stays removed: an intentional empty/typographic state beats
fake art.

## Current repository audit

| Asset | Path | Status | Provenance / license | Notes |
|---|---|---|---|---|
| Display font | *(system stack)* | shipped | OS-bundled (iOS New York / Android serif / web Georgia) — referenced by name, never bundled | Former TTFs (unknown/Microsoft provenance) deleted P9A. |
| Body font | *(system stack)* | shipped | OS default sans (SF Pro / Roboto / system-ui) | Former TTF deleted P9A. |
| Meta font | *(system stack)* | shipped | OS-bundled (Menlo / monospace) | Former TTF deleted P9A. |
| App icon | `assets/images/icon.png` + android adaptive set + `favicon.png` | shipped | Original mark generated in-repo by `scripts/gen-app-icons.mjs` (pure Node, no deps; deterministic, reproducible) | Kept-page + seal: flat ivory tile, moss page block, clay seal disc. Template-era blue mark deleted. |
| Splash image | `assets/images/splash-icon.png` | shipped | Same in-repo generator (mark on paper) | Template-era split-circle deleted. Wired in `app.json` (`expo-splash-screen`, ivory bg / `#16120E` dark). |
| In-app launch splash | `components/launch-splash.tsx` | shipped | Code-native: paper ground, display-face “Aoi”, ring-and-dot mark | Static; no variants, no scenes. |
| Splash variants + lab | *deleted* (`components/splash/*`, `app/splash-lab.tsx`, `config/splash-variant.ts`) | removed | Were in-repo experiments | Retired: splash is one restrained composition, not a variant system. The lab route is gone from production. |
| Landing orbs artwork | procedural (`components/landing/glass-orbs.tsx`) | shipped | Skia + Reanimated ambient glass discs (warm ivory light / charcoal-amber dark) with a thin orbit line; all tuning centralized in `OrbTuning`, no image file | Replaces the earlier user-supplied PNG pair and the code-native orb views. |
| Landing video/poster/grain, React logos, font TTFs | *absent from bundle* | removed | Were unknown-provenance/template leftovers | Removed P9A/P9B; no code references them. This row exists so nobody re-adds them. |
| Heart iconography | *none remaining* (was: tab icon, date icon, squeeze art, paywall bullets) | removed | — | Replaced by the seal-dot mark and typographic bullets. |

## Texture rule

Editorial Paper does **not** mean paper grain everywhere. Default UI
surfaces stay clean so text remains fully legible. Texture is permissible
only in: chapter/export covers, illustration assets, splash/brand artwork.
Never a repeated full-screen overlay by default. The existing
`film-grain.webp` landing overlay is grandfathered to the public landing
screen only; do not propagate the pattern.

## A1 — Welcome illustrations (procedural landing art)

The landing pairs the display-face wordmark + promise line + auth
(`components/landing/immersive-hero.tsx`) with a procedural animated
glass-disc scene (`components/landing/glass-orbs.tsx`, Skia +
Reanimated). No generated filler or embedded image was used for the
slot; the artwork is code drawn at runtime.

## A2 — First-memory empty state (removed from v1)

Code-native: Story's empty state is type-led (kicker/title/one line/one
action, `app/(app)/(tabs)/index.tsx`). Intentional without illustration.

## A3 — Waiting/invite visual (removed from v1)

Code-native: the waiting state is typographic (invite code row + “Your
invite is no longer active” truthfulness, `app/(app)/space.tsx`). No seat
graphic, no fake avatar.

## A4 — Envelope system (code-native, shipped)

Sealed/opened letters render as paper cards with a moss author dot and
clay accent state (`components/letters/letter-card.tsx`); the seal-dot
motif repeats in the squeeze mark and app icon. No envelope illustration
file; flat geometry only.

## A5 — Month / anniversary chapter covers (code-native, shipped)

Covers compose from **user photography + typography**, not per-chapter
illustration (`components/moments/chapter-cover.tsx`; grammar in that
file's doc comment matches this manifest):
- Ratios: 4:5 portrait master (wall/export share a 1:1 crop derivative).
- Crop: center-weighted; never destructive — ratios are presentation
  crops of the stored original.
- Title zone: lower third, ink on paper band (not text over faces);
  month/year or anniversary count in display face, meta kicker above.
- Fallback (fewer than 1 usable photo): paper ground + oversized numerals
  + one hairline rule. No filler photos.
- Paper treatment: `#FCF9F2` ground (dark: theme surface); grain only here.
- Permissible marks: single hairline rule, seal dot. Nothing else.

## A6 — Wordmark / app icon / splash (shipped; refinement deferred)

- Wordmark: display-face “Aoi” (system serif stack, A8 final) wherever
  rendered — landing hero, launch splash. No separate wordmark asset.
  Professional wordmark refinement (spacing/weight tuning) is an external
  brand task, explicitly deferred rather than faked.
- App icon: kept-page + seal mark (flat ivory tile, moss page block,
  clay seal disc), reproducible via `scripts/gen-app-icons.mjs`.
  Full-bleed safe to round-rect and circle masks; monochrome silhouette
  included; foreground mark sits in the adaptive safe zone.
- Splash: paper ground, centered mark (`splash-icon.png`) natively plus
  the in-app mark + wordmark composition. Static.

## A7 — Licensed demo photography (policy, no files added)

- No fake canonical couple may become product identity.
- Every demo image needs recorded source + license permitting the exact
  usage (dev-only vs. bundled vs. marketing are different grants).
- Record in this manifest before use: path, source, license,
  redistribution allowed yes/no/unknown, intended screens.
- Prefer observational imagery — objects, places, hands/details,
  environments — over posed romance; avoid recognizable stock clichés.
- Nothing was downloaded or scraped for this task; no demo photos exist
  in the repo. Any bundled photographyvetting happens before bundling.

## A8 — Font and motion specification

| Face | File | Role | Provenance | Redistribution | Status |
|---|---|---|---|---|---|
| Display serif | *(system stack)* | Display/title | OS-bundled (iOS New York / Android serif / web Georgia) — referenced by name, never bundled | n/a (no redistribution) | approved |
| Body sans | *(system default)* | Body/supporting | OS default sans (SF Pro / Roboto / system-ui) | n/a | approved |
| Meta mono | *(system stack)* | Meta/labels | OS-bundled (Menlo / monospace) | n/a | approved |

Substitution stays centralized in `FontFamilies` (`constants/typography.ts`).
P9A executed the replacement: all three faces are now OS system stacks, so
there is nothing left to license. If a licensed editorial face is ever
procured with a proven redistribution grant, it lands behind these same
three keys.

Restrained motion vocabulary (all existing primitives; no new framework):
page/section appearance = fade + 4pt rise, spring soft; sheet transitions
= platform sheet, no custom choreography; photo reveal = fade only, no
scale tricks; envelope opening = single-stage flap fade; chapter
transition = crossfade. No bounce, no loops, no staggered cascades.
Everything honors `useReducedMotion()`; motion never carries meaning
alone. Durations live in `Motion` (`fast 160 / base 240 / slow 360`).

## Implementation scaffolding

- `assets/README.md` documents the shipped set and the generator.
- `scripts/gen-app-icons.mjs` regenerates every PNG in `assets/images/`
  deterministically (`node scripts/gen-app-icons.mjs assets/images`).
  No image tooling required — pure Node + zlib.
- No asset-path code module was added: the only bundled images with code
  consumers are the icon/splash set (via `app.json`). Product UI uses
  code-native treatments and user photography only.
