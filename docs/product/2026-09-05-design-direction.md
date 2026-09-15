# Aoi design direction — Editorial Paper

Status: proposed concept for review. Codex owns product decisions; this brief implements the chosen direction. Source critique and concept are clearly identified: prior screenshot attempts have not established the app's actual visual appearance, so nothing here claims to depict the shipped UI.

## Recommendation

Choose **Editorial Paper**: a warm, book-like interface where photos and words carry the emotion and chrome stays quiet. Three destinations — **Story / Together / Plans** — with Space and settings behind the avatar. **Someday belongs in Plans**, not duplicated under Together. **Together** gives sealed letters and the optional weekly reflection a real home. **Story** holds the timeline plus memory-wall views and resurfacing. Composer is split by context: Photo / Note / Voice from the primary floating action, letter compose under Letters, plan compose under Plans. No generic six-choice sheet. No user-facing kept counts, metrics, or streaks. No mandatory theme, anniversary date, partner name, or space name.

Palette (matches `artifacts/design-review/proposal.html`): paper `#FCF9F2`, ink `#1E1B16`, secondary text `#5E564A`, hairline `#E3D8C3`, subtle surface `#F3ECDD`, moss primary `#334E45` with paper text `#FCF9F2`, clay authorship `#8A3E28`. Moss carries primary actions and active states; clay is reserved for small authorship marks, bylines, and the letter seal on white and ivory paper. All body and button text targets 4.5:1 or better.

## Flows

Onboarding is emotion first, admin later, partner never blocked. Welcome offers create or invitation, then required sign-in, then one short setup screen with prefilled own name, optional partner name, and a defaulted space name. Story follows with an inline first-memory invitation; after the first save the app offers the native invitation share. The creator can invite first or skip and keep adding — never wait-blocked. Theme, photo, and date details live later in Space, not as gates.

Joining preserves the invite through sign-in into a privacy-safe confirmation of the intended space, then lands in Story on actual partner content with no duplicate creator setup. Invalid, full, or expired invites offer recovery rather than dead ends. Authentication is never bypassed, and unauthenticated invite metadata is never rendered. The real empty state never renders fictional partner content; sample names and memories in the concept sheet are labelled outside the phones as illustrative.

## Three directions considered

**Editorial Paper (chosen).** Flat ivory paper, 1px hairlines, 14–16px radii, New York display at 30–32px for screen titles and ~21px for card titles, system sans body, sentence-case meta. The thread becomes whitespace and dividers rather than rails and shadows. Tradeoff: less beachy and cinematic than today’s landing warmth; it risks feeling bookish for a playful brand. It wins because it scales from 5 to 500 memories, keeps photos dominant, and is cheapest to build — deleting heavy shadows, glass, and oversized forms.

**Soft Film.** Keeps the landing-video language: deep warm darks, cream type, full-bleed photos, grain. Beautiful for the memory wall and anniversaries. Tradeoff: dark-first hurts daytime journaling, text-on-photo is fragile for contrast, and grain plus video costs performance and battery. Better as campaign language than daily driver; retained in the sheet only as a palette study.

**Quiet Keepsake.** Stationery-like calm: vast whitespace, small type, dotted structure, text buttons, almost no pills. Calmest of the three. Tradeoff: austerity reads as broken in empty states, touch targets get ambiguous, and older users lose affordances. Also retained only as a palette study, same layout for colour comparison.

A correction to prior reasoning: five tabs are not inherently unusable; the problem is this app’s hierarchy and redundant destinations — Profile versus Settings, Together as a settings-like list, calendar complexity forced into tiny cells. Likewise, the prior draft overstated contrast and type claims without measurement. This brief makes no measured-violation claim about the current teal, prescribes no display-type scale caps, and asserts no blanket rule about uppercase and screen readers.

## Scope, native, and limits

Screen and flow scope: reshape tokens, collapse five tabs to three with avatar-led Space, collapse onboarding to welcome, sign-in, one setup screen, first-memory invitation, and native share. Story uses underline segments (All / Photos / Voices / Letters) rather than pills, with the wall as a filtered view, month dividers, flat cards with a small author edge, and resurfacing kept quiet until there is history worth revisiting. Together composes sealed versus opened letters with an envelope ritual plus the optional weekly question answered side by side, with squeeze as a plain text action. Plans simplifies the month to day numbers with one dot per event, a ring for anniversaries, and an inline agenda with Add and Suggest-a-time; goals live here as a Coming-up list. Space consolidates invite code with copy and share, theme swatches, a plain Plus row, and sign-out, leave, and delete with honest consequences. Simplify composer, fold the wall into Story filters, compose Together from letters plus weekly reflection, simplify Plans to dots plus agenda, and give letters a sealed-versus-opened ritual. Out of scope: location sharing, second sealed-letter mechanics, lifetime and encryption promises, and import-as-homework.

Native differences: iOS uses large titles, native share sheet, tab-bar blur only, and light/medium haptics for letter and squeeze moments; Android drops fake blur, uses elevation only on the composer sheet, and keeps Material pickers with edge-to-edge insets. Both use standard native navigation, 44pt minimum targets, flexible dynamic type without truncation of names, and reduced-motion paths that cross-fade and still the landing video.

Source versus browser limits: this concept is HTML and CSS only, self-contained except the local landing poster and New York font. It cannot prove native feel, haptics, share sheets, dynamic-type reflow, or real contrast under system settings. Phone controls are static mocks; only the page-level palette switcher is interactive and exposes `aria-pressed`. Review in the sheet for tone and hierarchy; validate feel, performance, and accessibility in native builds.
