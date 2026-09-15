# Aoi visual foundations (P1A) — Editorial Paper

Aoi is a private relationship archive: “Save the little things now; enjoy
your story together later.” The UI is intimate, editorial, quiet, tactile
without skeuomorphism, photographic, mature, readable.

## Principles

- Editorial paper: warm ivory ground, ink type, restrained moss/clay color.
- Photography gets the visual weight; chrome stays out of the way.
- Hierarchy through typography, spacing, paper tone, subtle borders.
- Minimal card chrome: group with space and hairlines, not floating cards.
- Restrained color: moss = primary action, clay = rare accent.
- No gamification visual language.

## Canonical tokens (`constants/theme-presets.ts`)

Semantic roles — never raw palette names in feature code:

- `background` `#FCF9F2` (paper) · `backgroundSubtle` `#F3ECDD` (paper variation)
- `surface` `#FFFDF8` · `textPrimary` `#1E1B16` · `textSecondary` `#5E564A` · `textMuted` `#8A8175`
- `border` `#E3D8C3` (hairline) · `borderStrong` `#C9B99B`
- `primary` moss `#334E45` · `primaryPressed` `#28403A` · `primaryText` `#FBF8F1`
- `accent` clay `#8A3E28` (rare) · `destructive` `#8F3A2A` · `destructiveBackground` `#F5E4DC`
- `disabled` `#B9AE9C` · `overlay` `rgba(30,27,22,.45)`

Read via `useThemeColor({}, '<role>')`. Legacy beach keys (`text`,
`muted`, `danger`, …) remain for compat; prefer the roles above.
Dark tokens exist only because the theme infrastructure requires them;
Editorial Paper light is the product direction.

## Typography (`constants/typography.ts`, `ThemedText`)

Roles: `display` 32 · `title` 22 · `body` 16 · `bodyEmphasis` 16 semibold ·
`supporting` 14 · `caption`/`label` 13 · `meta` 13 mono, sentence case.
Meta is never forced uppercase. Dynamic Type stays on: no
`allowFontScaling={false}`, no fixed-height text containers.

Current fonts (already in `assets/fonts`, loaded by `useAoiFonts`):
display `AoiDisplayNewYork`, body `AoiBodyTrebuchet`, meta `AoiMetaMono`.
All three faces are **provisional** — see `docs/design/asset-manifest.md`
(A8) for provenance findings. Do not treat in-repo TTF presence as
redistribution rights. `FontFamilies` is the single substitution point;
a system-safe fallback (SF Pro / Roboto body) must be ready before any
production release. New York is an Apple-platform visual reference, not a
cross-platform production guarantee.

## Layout (`constants/theme.ts`, `Screen`)

Spacing scale 4/8/12/16/24/32(/40/56). Defaults: screen gutter 16,
section rhythm 24, text-stack 4–8, touch minimum 44×44, media separated
by 12–16. `Screen` (`components/ui/screen.tsx`) provides safe-area shell
+ gutter + rhythm. Avoid giant empty center rails (shell caps at 560).

## Radii / borders / elevation

- Default containers: no radius or small (`sm` 6 / `md` 10); `lg` 16 for
  sheets and intentional objects only. `pill` is retained but discouraged —
  buttons no longer use it.
- Grouping via `hairlineWidth` borders (`border`), emphasis via
  `borderStrong`. No decorative shadows; `raised` is a restrained
  4pt/8%-opacity lift for overlays/sheets only.

## Primitives (`components/ui/`)

`Button` (primary moss / secondary hairline / ghost text / destructive
outline; 44pt min; pressed + disabled states), `PaperTextInput`
(underline hairline, focus/error states), `Divider` (hairline),
`SectionHeading` (kicker + title), `MediaFrame` (4:3 default, hairline),
`Screen`, `Surface` (flat card + restrained raised; `glass` retained
untouched). `ThemedText` roles map to secondary/muted tones for
supporting text automatically.

Reference: `app/dev-foundations.tsx` (dev-only, unlinked).

## Anti-patterns (do not add)

Nested cards · pill buttons everywhere · large decorative shadows · tiny
metadata-dense rows · centered narrow dashboard rails · purposeless
gradients · fake paper texture tiling · generic heart motifs · teal/coral
beach accents · uppercase shouting meta.

## Deferred

Retiring the legacy beach presets/theme picker, final body-font
licensing decision, screen-by-screen migration to these primitives,
Story/Together/Plans, chapter covers, illustrations, splash redesign.
