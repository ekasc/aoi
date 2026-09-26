# Brand direction: overhaul of the Us screen

Intimate after-hours: the sky stays the emotional anchor, everything below it goes quiet, warm, and touch-first. No dashboard chrome — one focal moment, one heartbeat action, two quiet doors.

## Tokens
- Color (reuse `constants/theme-presets.ts`, default `after-hours`; no new hex):
  - `background` / `backgroundSubtle` for page + subtle section wash
  - `surface` (30% frosted via `withAlpha`, so the wine backdrop reads through) for waiting card + Letters/Reflection rows
  - `textPrimary` / `textSecondary` / `textMuted` for ink hierarchy (must clear 4.5:1 — guarded by `tests/unit/theme/after-hours.test.ts`)
  - `primary` / `primaryPressed` + `primaryText` for the squeeze pill only
  - `border` hairline + `borderStrong` for rows; `shadow: rgba(44,28,43,0.12)` light / `rgba(0,0,0,0.45)` dark; `overlay rgba(44,28,43,0.45)`
  - Sky overlay ink stays `#FFF3EA` with `textShadow rgba(0,0,0,0.28), radius 12`
  - Tints via `AccentWash = 0.10` only (0.16 fails AA)
- Spacing (`constants/theme.ts`): gutter `16`, section rhythm `24`, tight `8` / `12` inside cards; sky block bleeds `−16` horizontal
- Radius (`Radii`): `card 12` for waiting card + rows, `pill 999` for squeeze, `none 0` for sky bleed
- Shadow / motion (`Motion`): `fast 160` press feedback, `base 240` card transitions, `slow 360` sky glow only; squeeze bounce `1.0 → 1.08 → 1.0` (110ms each), double-thump haptics 120ms apart, fully gated by `useReducedMotion`

## Type
- Families (`constants/typography.ts`, system stack only, zero bundled binaries): display serif (`New York` iOS / `serif` Android / `Georgia` web) + body/meta system sans; no monospace anywhere
- Scale: `display 32/38 −0.5` / `title 22/26 −0.4` / `subheading 18/24` / `body 16/24` / `supporting 14/20` / `caption + label + meta 13/19`
- Roles on this screen:
  - Pair names → `display` in `#FFF3EA` over the sky (top-left, `Spacing[24]` inset)
  - Days-together → `caption` in `#FFF3EA` directly under names (sky's own caption keeps the count)
  - Waiting-card headline → `title` or `subheading`; supporting line → `supporting` in `textSecondary`
  - Squeeze label → `bodyEmphasis` on `primary`; hint above → `caption` in `muted`
  - Letters / Reflection row titles → `body` in `textPrimary`; status (`Ready`, `Opens in 3 days`, `This week`) → `caption` in `muted`
  - Never cap `maxFontSizeMultiplier`; Dynamic Type reflows

## Rhythm
- Layout: single column `ScrollView`, `gap 16`, `paddingHorizontal 16`, `paddingTop insets.top + 8`, `paddingBottom insets.bottom + 24 (+ iOS tab clearance)`; sky immersive `max(340, 52% viewport)` as title card
- Density: calm — sky → one waiting card → centered squeeze → two quiet rows; generous whitespace, no sheets, no duplicate previews, no capture entry (Memories owns it)
- Touch: 44px minimum everywhere (`minHeight 44`, `minWidth 44`); rows `minHeight 48`; pressed states are opacity-only (`0.75` squeeze, `0.9` rows)
- Motion feel: stillness first — instant opacity press, one spring (squeeze bounce) only, sky glow (`letter` / `question` / null) as the only ambient signal; reduced-motion collapses all springs to static
- A11y rhythm: labelled `button` roles, `accessibilityState` on squeeze (`disabled` while sending), `accessibilityLiveRegion` for sent/failed status, decorative sky photo marked `accessible={false}` inside labelled targets

## References
- Palette: `after-hours` — frosted wine + soft rose light + cool pink accents (`#8E3659` / `#E7A3BB` dark); fallback sensibility from `editorial-paper` (warm ivory, ink type)
- In-repo prior art: `components/home/memory-sky.tsx` (sky treatment + glow states), `components/home/us-waiting-card.tsx` (focal selector `selectUsFocal`), `/dev-foundations` gallery (Editorial Paper tokens), `/dev-together` preview
- Feeling refs: night-sky title card with serif names; heartbeat squeeze (two Medium haptics, 120ms apart); quiet doors with live status instead of counts — the wait itself has a shape
