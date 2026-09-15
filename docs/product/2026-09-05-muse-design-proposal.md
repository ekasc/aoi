# Aoi Design Proposal — Make It Pretty Enough to Keep

> Raw Muse worker proposal, retained for review history. Use `2026-09-05-design-direction.md` for the reviewed direction. Codex rejected the unsupported contrast claim (the existing teal button measures 7.27:1), the extended onboarding, duplicate Someday placement, and blanket claims about five tabs and screen readers. This document is not the implementation specification.

> Source-only proposal. I inspected source, I did **not** inspect `http://localhost:8081`. Codex is doing screenshots separately. Anything about how it *feels in hand* below is marked **[Hypothesis]** vs **[Found]**.

Beauty is not decoration for Aoi. For a private keepsake for two, beauty *is* the value proposition: if adding a moment feels like a form, people won't add the second one. If the timeline looks like a productivity app, they won't revisit it on an anniversary. The paid promise in `docs/product/2026-09-05-product-assessment.md` — "save little things now, enjoy your story later" — only converts if the later looks worth paying for.

## 1. Candid diagnosis

### Navigation sprawl is the #1 ugliness

**[Found] `app/(app)/(tabs)/_layout.tsx`** has 5 tabs: Timeline / Calendar / Together / Profile / Settings. Five is unmanageable on a phone and it shows:

- `index.tsx` Timeline, `calendar.tsx`, `together.tsx`, `profile.tsx`, `settings.tsx` all use the same recipe: `maxWidth: 720` centered column + `Surface` cards + `type="title"` hero. There is no hierarchy. Everything shouts at the same volume.
- Together (`together.tsx:75-133`) is a 4-row `Pressable` list — Someday, Letters, Memory wall, This week — each with a grey `surface2` status pill. It reads like Settings, not like "the shared things." Letters — your emotional differentiator — dies here as row #2.
- Profile and Settings split what should be one quiet place. Profile has Time together + You + Your space + Actions (Edit relationship, Import milestones, Little things, Sign out). Settings repeats Appearance + Plus + Sign out + Leave + Delete. Two identities, two sign-out buttons.
- Calendar (`calendar.tsx`) is the most engineered and least calm screen: infinite pager, double-tap/long-press day cells, event-title chips inside 6-row grids, `+1 more` chips, FAB, DaySheet modal, proposals panel with `variant="glass"`. That complexity forces tiny 11px chip text and `‹ ›` text buttons as month nav. It cannot be beautiful in its current scope.

### Onboarding asks for admin before emotion

**[Found] `components/setup/concepts/interview.tsx` + `use-setup-flow.ts` + `app/(auth)/space-import.tsx` + `app/(auth)/theme-select.tsx`:**

- Interview is one-question-per-screen with `ProgressDots` + `1/5` counter + 28px serif title + 50px-high centered `SerifInput`. For "What should we call you?" this ceremony is charming. By step 4 ("Name your space" defaulting to `Our space`) + step 5 (date picker) it feels like a quiz. Back goes to `signOut()` on step 0 — easy to nuke a session by accident.
- `use-setup-flow.ts:149-163` still handles `photoUri` upload, but `interview.tsx` never asks for a photo. **[Found]** Dead path / ordering bug already flagged in the product assessment. That explains why `index.tsx:246` has a 44px `heroPhoto` that most spaces will never fill.
- `space-import.tsx` is the cliff: "Step 2 of 3 — Add your story so far" with dynamic rows, each row having 4 type chips (`milestone/goal/date/note`), title + details `TextInput`s, `NativeDateTimeField`, goal target toggle. To a new couple this says: do homework before you see value. Skip exists but is visually equal to Continue in the footer — no encouragement.
- `theme-select.tsx` ends onboarding with "Final step — Choose a theme" + `ThemeSelector` + "Your space is ready." Theme choice is lovely as a gift, terrible as a gate. It also teaches users that themes are structural, which they aren't.

Result: no first-memory moment, no invite/waiting state, no reason for partner #2 to care when they arrive.

### Type + surface system fights intimacy

**[Found] `constants/typography.ts`, `components/themed-text.tsx`, `constants/theme-presets.ts`, `components/ui/surface.tsx`, `components/ui/glass-surface.tsx`, `components/ui/button.tsx`:**

- Body is `AoiBodyTrebuchet` 16/24 with `letterSpacing: 0.05`. Trebuchet is narrow, spiky, and office-coded. At 13px caption with 0.1 tracking it looks anxious, not calm. Display is `AoiDisplayNewYork` 44/50 — gorgeous, but `moment-form.tsx:435` and `interview.tsx:243` override to 40px and 28px ad hoc, so display has no scale.
- `themed-text.tsx:73-76` forces `meta` to `uppercase`. Uppercase 12px mono with 0.7 tracking for "Upcoming goals," "Time together," "Entry 1" makes the app hector. Intimate apps whisper meta.
- Palette `sunset-shore` light: `background #F0DFCA`, `surface #FFF6EC`, `accent #4ECDC4` teal, `partnerAccent #E07A5F` terracotta. **[Found]** Teal + terracotta vibrate against warm sand; `onAccent #0C312D` on teal is low-contrast and chilly. `sea-glass` light pairs `#26D0CE` with `#A8E6CF` — two greens with no author distinction. Dark modes are better, but light — your default — is too saturated to feel like paper.
- `surface.tsx` `raised` uses `shadowOpacity: 0.18, shadowRadius: 20, offsetY: 12` on iOS. That's a SaaS card shadow. Combined with `Radii.lg: 20` + `pill: 999` everywhere (buttons, type chips, target toggles, FAB, status pills) everything looks inflated. `glass` variant wraps `expo-glass-effect` on iOS and a fake `AndroidGlassSurface` elsewhere — used once, for proposals in calendar. Glass for a single alert is incoherent.
- `button.tsx`: primary is solid accent pill, secondary is `surfaceSubtle`, ghost is *dashed border* (`borderStyle: dashed`). Dashed ghost + dashed goal cards in `moment-card.tsx:189` = two dashed languages.

### Capture and cards: too many decisions, too little ceremony

**[Found] `components/moments/moment-form.tsx`, `components/moments/moment-card.tsx`, `app/(app)/letters.tsx`, `components/letters/letter-card.tsx`, `app/(app)/memory-wall.tsx`:**

- `moment-form.tsx` shows 5 type cards (`note/milestone/date/media/goal`) in a 48% wrap grid, then title (22px serif input), then 120px note, then goal toggle, then `occurredCaption` ("Today · ..."), then footer with two full-width buttons. A photo moment and a one-line trace go through the same heavy form. No wonder traces needed a separate route (`/(app)/moment/trace` in `index.tsx:211`).
- `moment-card.tsx` puts a 12px knot on a center `thread` rail, then a full `Surface raised` card with author dot + type label + date + title (`type="title"` 30px!) + 180px photo + goal pill + audio + body. Two moments = two 30px headlines + two shadows + rail dots. Mature data will feel loud, not layered.
- Letters are actually well-written — `letter-card.tsx` never renders sealed bodies, `letters.tsx` has a 20s tick for "Opens in…" — but the shelf is a plain `ScrollView` of identical `Surface` cards with a small `Write` outline button. Sealed vs opened differ only by serif body. No envelope, no wax, no ritual. **[Hypothesis]** This is why letters test as "nice" not "must-pay-for."
- Memory wall (`memory-wall.tsx`) is the prettiest primitive: 2-col photos, full-width voice rows, author dot overlay. But reached only via Together row #3, with empty state as centered caption. It should be the payoff, not a basement.

Landing (`app/(public)/index.tsx` + `ImmersiveHero` + landing video + grain) is your best visual asset. Nothing inside the app matches its film warmth.

## 2. Feature placement map

| Keep where | Merge | Remove from v1 nav | Defer |
|---|---|---|---|
| **Story:** timeline, resurface, memory wall (as segment), first-memory CTA | Profile + Settings → one **Space** sheet (avatar → space, invite, theme, Plus, leave/delete) | Live location / partner map (per assessment: disable entry + background together) | Splash lab, alternate interview concepts |
| **Together:** letters, this-week question, someday, time-together, squeeze, invite/waiting status | Calendar + proposals + goals/upcoming → one **Plans** tab | `Trace` as separate composer destination (fold into composer) | Little things device-only (sync or hide; don't sell as keepsake) |
| **Plans:** month grid + agenda + suggest-a-time + lightweight important dates | Import milestones → one-time onboarding + Space → Add past moment (not a tab) | Memory wall as standalone tab-level push (becomes Story filter) | Second sealed-letter mechanics, E2EE claims, lifetime promises |

Concretely: delete `profile.tsx` and `settings.tsx` tabs. Keep their routes as sheets under `/ (app)/space/*`. Delete location tab entry (`profile.tsx:175-208` location row + dot). Keep location code dormant, not visible. Move `someday`, `letters`, `memory-wall`, `question` out of a generic list and into composed Together sections (see §5).

## 3. Two-tab vs three-tab — choose three

**Two-tab (Story / Together):** most intimate, fewest taps. Fails because Plans has opposite ergonomics (month grid, time labels, proposals need tabular-nums, agenda density). Forcing calendar into Together buries time-sensitive proposals under letters. Composer FAB would have to serve 6 types — overload.

**Three-tab (Story / Together / Plans):** matches mental model — *what happened / what we share / what's next*. Lets each tab have its own composition: Story = vertical thread, Together = soft sections, Plans = month + agenda. Tab bar stays thumb-friendly. Cost is one more icon, but you delete two tabs net (5→3).

**Decision: 3 tabs.** Labels: `Story`, `Together`, `Plans`. Icons: `book-outline`, `heart-outline`, `calendar-outline` (filled when focused). Center composer is a circular `+` button *above* the tab bar, not a tab — opens one sheet (see §5). Space/settings is an avatar in Story header, not a tab.

## 4. Reshaped onboarding

Principle: **emotion first, admin later, partner never blocked.**

Flow:

```
Landing (keep video)
 ├─ Create → You two (1 screen) → First memory (1 screen) → Invite + Waiting → Theme gift → Story
 └─ Join → Code (1 screen) → You (1 screen) → Theme gift → Story (sees first memory)
Skip anytime → Story (empty, with gentle nudge). Photo deferred to First memory.
```

Four screens total, not 5+import+theme gate.

**Screen 1 — Begin (replaces mode step)**
Title: `A private place for the two of you.`
Sub: `Keep photos, notes, and letters. Revisit them together.`
`[ Create our space ]` primary
`[ Join with a code ]` secondary
Footnote: `Free to start. One subscription covers both of you later.`
**[Found]** Current `ModeInline` auto-advances on select — surprising. New: explicit tap, no auto-advance.

**Screen 2a — Create: You two (single screen, replaces 3 steps)**
Title: `Who's this for?`
Fields (all on one screen, stacked, 56px rows):
`Your name [ Maya ]`
`Their name [ June ]`
`Since when? [ June 14, 2022 ▾ ]` — default empty, placeholder `Pick a date`, never default to today.
Button: `Continue`
Helper: `You can change these later in Space.`
Error (inline, not alert): `Tell us both names so your story knows who’s who.`

**Screen 2b — Join: Code (replaces join branch)**
Title: `Enter your invite code`
6-cell code (keep `InviteCodeField` — it's good) + `Continue`
Helper: `Ask Maya to find it in Story → avatar → Invite.`
Error: `That code didn’t match. Check the 6 letters — no spaces.`

**Screen 3 — First memory (replaces `space-import.tsx`)**
Title: `Keep your first moment`
Sub: `One photo or a few words. You can add the rest later.`
Composer-lite: `[+ Photo]`, `Title [ First date at the garden ]`, `Note [ … ]`
Buttons: `[ Keep this moment ]` primary, `Skip for now` text-button
This creates the space *first*, then attaches media (fixes `use-setup-flow.ts:149` ordering bug). Never ask for 4-type taxonomy here.

**Screen 4 — Invite + Waiting (new, critical)**
If creator: Title: `Invite June`
Big code card: `J K 4 P 2 Q  [ Copy ] [ Share ]`
Sub: `June will see your first moment as soon as they join. You don’t have to wait — keep adding.`
Button: `Go to our story`
If joiner: after code, show `You → Maya & June’s space` confirm with their first memory preview.

**Screen 5 — Theme gift (replaces `theme-select.tsx` gate)**
Title: `Pick a look for both of you`
Sub: `Warm paper by day, cozy lamp by night. Change anytime.`
3 swatches only (no descriptions). Button: `Start our story`. Skippable with `Decide later`.

No progress `1/5` counters. Show `Back` that never signs out except via Space sheet.

## 5. Three visual directions

### A — Editorial Paper (RECOMMENDED)
Warm paper background `#F6EFE3`, ink `#1C1917`, muted `#6B5F54`, hairline `#E2D5C2`. Accents: clay `#C76E4E` (you) + deep moss `#3E6B5E` (partner). No teal. Display: New York 28/34 for titles, 22 for card titles (not 30). Body: system sans (SF Pro / Roboto) 16/24, not Trebuchet. Meta: 12px sans, sentence-case, tracking 0.2, never uppercase. Composition: flat paper, 1px borders, 16px radius, no shadows except composer sheet. Thread rail becomes a 1px dotted line, knots become 8px dots.
*Tradeoff:* less "beachy," more bookish. *Why win:* reads at 5 memories and 500; cheapest to build (delete glass/shadows); photo-forward without competing with photos.

### B — Soft Film
Keeps landing video language: deep warm dark `#171310`, cream `#F1E2CD`, amber `#D4A373`, film grain overlay, full-bleed photos, white serif on image. Gorgeous for memory wall.
*Tradeoff:* dark-first alienates daytime journaling; text-on-photo a11y hard; grain + glass + video costs perf/battery. Best as campaign, not daily driver.

### C — Quiet Keepsake
Japanese stationery: vast whitespace, 14px body, tiny dots, thread only, no pills, text buttons. Calmest.
*Tradeoff:* too austere for playful brand; empty states feel broken; older users find touch targets unclear.

**Pick A.** It preserves playful/intimate/calm while killing Trebuchet (cold-office), glass (techy), and overgrown forms (anxious). Keep New York — it's your only true personality marker.

## 6. How finished tabs look & behave

**Story (home):** Header: couple photo (or monogram if none) + `Maya & June` serif 22 + `1,214 days · 86 kept` meta sentence-case + avatar → Space. Composer `+` floats above tab bar. Filters: `All | Photos | Voices | Letters` as underline segments, not pills. Little data: one hero card — `Your story starts with one moment [Keep your first moment]` + resurface hidden. Mature: month dividers (`June 2024`), cards flat with 12px radius, author color as 2px left edge (not full border), photos full-bleed top with 12px radius, voice inline. No center rail after 20 items — rail becomes left edge to aid scanning.

**Memory (inside Story):** Not a separate tab. `Photos` filter becomes wall grid (keep `memory-wall.tsx` packing logic, increase to 3-col on tablets). Author dot moves to caption, not photo overlay. Empty: illustration + `Photos and voices you keep will gather here.`

**Together:** Sections, not rows. Hero: `Time together` big serif count. Card 1: `Letters` — sealed envelopes (closed, date, "Opens in 12 days") vs opened serif excerpts. Card 2: `This week` — question + both answers side-by-side, color-edged. Card 3: `Someday` — checklist, not gallery. Footer: invite status (`Waiting for June • Resend`) + squeeze as `Send a squeeze` text-button with haptic, not a heart icon hidden in Profile.

**Plans:** Month grid simplified: day numbers only, one dot per event (you=moss, partner=clay), anniversary = ring, not dot + chip. Selected day opens agenda below (not modal) with `Add` + `Suggest a time`. Proposals render as calm banner, not glass. Goals live here as `Coming up` list, not on Story. Little data: `Nothing planned — the day is open.` + `[Add]` . Mature: agenda paginates, month never shows titles inside cells.

**Space (ex-Profile+Settings):** Avatar sheet: space name, since-date, invite code with copy/share, theme swatches, Plus row (`One subscription for both of you [Learn more]` — no backend promises), Session: Sign out / Leave / Delete with plain-language consequences matching real behavior (fix `settings.tsx:48` lie about email + purge).

## 7. Native, accessibility, motion

- iOS: use `UINavigationBar` large titles for Story/Together/Plans, native share sheet for invite, `expo-glass-effect` only for tab bar blur, not cards. SF Symbols via `Ionicons` mapping ok, but use `heart.fill` etc. Haptics: light on seal/open letter, medium on squeeze, none on tab switch.
- Android: no fake blur (`AndroidGlassSurface` delete). Use `elevation: 2` only on composer sheet, Material 3 date picker (`NativeDateTimeField` already does). Edge-to-edge + `insets.bottom` respected (already good).
- A11y: min 44px targets (fix 36px back button in `interview.tsx`, 8px dots), `accessibilityLabel` on all icon-only buttons (keep pattern), dynamic type: allow body to scale, cap display at 1.2x, never truncate names. Contrast: clay `#8A3E28` on paper passes 4.5:1; current teal on sand does not — fix before ship. Meta sentence-case improves VoiceOver (uppercase reads letter-by-letter in places).
- Reduced motion: respect `useReducedMotion()` everywhere (already in interview + timeline). Replace `FadeInDown` cascades with cross-fade when reduced; pause landing video (already done); no parallax on wall.

## 8. Redesign sequence (scoped, screen-by-screen)

1. Tokens: fix `theme-presets.ts` (paper bg, clay/moss), `typography.ts` (drop Trebuchet → system, meta sentence-case, 28/22/16 scale), `surface.tsx` (kill heavy shadow, 16px radius).
2. Tabs: 5→3 + composer FAB + Space sheet shell.
3. Onboarding: collapse interview to You-two + First-memory + Invite/Waiting + Theme gift; fix space-before-photo.
4. Composer: one sheet with Photo/Note/Voice/Letter entry, progressive type (not 5 cards).
5. Story + wall filter, Together sections, Plans simplification (dots not chips).
6. Letters shelf ritual (envelope closed state, open transition).
7. A11y/contrast pass + reduced-motion audit.

**Inspected:** `PRODUCT.md`, `docs/product/2026-09-05-product-assessment.md`, `constants/theme.ts`, `constants/theme-presets.ts`, `constants/typography.ts`, `components/setup/setup-wizard.tsx`, `components/setup/concepts/interview.tsx`, `components/setup/use-setup-flow.ts`, `components/setup/setup-primitives.tsx`, `app/(auth)/theme-select.tsx`, `app/(auth)/space-import.tsx`, `app/(app)/(tabs)/_layout.tsx`, `index.tsx`, `calendar.tsx`, `together.tsx`, `profile.tsx`, `settings.tsx`, `components/moments/moment-card.tsx`, `components/moments/moment-form.tsx`, `components/letters/letter-card.tsx`, `app/(app)/letters.tsx`, `app/(app)/memory-wall.tsx`, `app/(app)/moment/new.tsx`, `components/ui/surface.tsx`, `glass-surface.tsx`, `button.tsx`, `themed-text.tsx`, `app/(public)/index.tsx`.

No files modified, no commands run, no browser claimed.
