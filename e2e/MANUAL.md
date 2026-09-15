# Manual-device checklist — everything Maestro cannot do reliably.
# Run on a physical iPhone + Android device against a preview build.

## Auth
- [ ] Apple sign-in on iOS (native sheet) succeeds and lands in setup.
- [ ] Google sign-in on Android succeeds.

## Partner (two devices)
- [ ] Creator Space shows invite code; partner joins with it.
- [ ] Both see the same Space, memories, letters, Plus state.
- [ ] Partner leaves: creator keeps history; creator sees waiting state.

## Media
- [ ] Photo capture (library + camera) keeps a memory; Wall shows only it.
- [ ] Voice recording keeps a trace; playback works.
- [ ] Chapter with portrait + landscape photos renders uncropped in Story.
- [ ] Chapter PDF export shares/saves; long note paginates, no clipped text.

## Store
- [ ] Sandbox purchase activates Plus (both members after refresh).
- [ ] Restore purchase works; cancel/failure copy is accurate.
- [ ] Quota interception copy appears when Free storage is full.

## Push
- [ ] Permission prompt appears once; squeeze/letter/event pushes arrive.
- [ ] Denied permission degrades quietly (no errors, no loops).

## OS behaviors
- [ ] Dynamic Type XL: no clipped text in primitives, paywall, Space hub.
- [ ] Reduced motion: no essential animation-dependent meaning.
- [ ] Dark mode: readable contrast on Story/Together/Plans/Space.
- [ ] Offline cold start: honest loading/empty states, no false success.

## Lifecycle
- [ ] Delete account (test account): sessions revoked, partner keeps history.
- [ ] Expired invite shows regenerate path, never a dead code.
