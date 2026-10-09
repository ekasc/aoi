# Relationship sheet rendering

The physical iPhone reproduced a blank relationship editor on first presentation in light and dark mode. The title and fixed footer appeared, but the scrollable inputs did not. Changing only Aoi's appearance override changed the colors without making the inputs appear. The phone's system appearance setting was not changed.

The temporary standard-modal workaround was reverted. The editor retains its original native form sheet. Its content is now a root ScrollView containing the inputs and actions, with automatic content and keyboard insets. The previous KeyboardAvoidingView wrapper and separate footer were removed. This follows the native sheet's direct-child scroll-view layout path instead of its descendant frame-correction fallback. No palette or matching logic changed.

## Evidence

- Xcode built successfully with two workers; `com.ekasc.aoi.dev` was installed and launched on the physical phone. No simulator was started and no app data was reset. Logs: `.expo/crit/latest-dev-phone-build.log`, `.expo/crit/latest-dev-phone-install.json`, `.expo/crit/latest-dev-phone-launch.json`.
- Memories displayed its sky and empty-state copy after launch: `.expo/aoi-debug/screenshots/2026-10-02T22-08-57-580Z-mr45b0.jpg`.
- Blank light-mode form before the root-scroll fix: `.expo/aoi-debug/screenshots/2026-10-02T22-10-00-949Z-xw69d8.jpg`.
- Changing Aoi to dark mode still left the old layout blank: `.expo/aoi-debug/screenshots/2026-10-02T22-11-12-735Z-nrzdon.jpg`.
- Fixed form on a fresh light-mode reopen: `.expo/aoi-debug/screenshots/2026-10-02T22-14-25-043Z-7d5zv9.jpg`.
- Scrolling reached the date field and both actions: `.expo/aoi-debug/screenshots/2026-10-02T22-15-44-408Z-fuvwle.jpg`.
- The partner input accepted focus. Native keyboard metrics reported height 301 and screen Y 573. The root screenshot shows the focused input, but does not capture the separate keyboard window.
- Fixed form on a fresh dark-mode reopen: `.expo/aoi-debug/screenshots/2026-10-02T22-21-20-489Z-8qx1ns.jpg`. The app appearance override was then cleared and its temporary global removed.
- Regression coverage asserts that the form sheet receives a root scroll view containing inputs and actions, with keyboard inset handling. Existing save validation and update tests remain in place. Four editor tests passed. The full suite passed 2,512 tests in 233 files with two workers. Typecheck, scoped ESLint, accessibility audit with zero findings, and whitespace checks passed.

No edits were saved to the real relationship during verification. Native accessibility captures still report zero elements, so these screenshots do not prove VoiceOver behaviour.

## Content-sized editor and separate date sheet

The editor now uses `fitToContents`, not a full-height detent. A ScrollView does not supply an intrinsic content height to the native sheet, so the editor feeds its measured content height back into the scroll frame. Scrolling remains available when native presentation limits its height.

The separate iOS spinner sheet is retained. The clipped-picker screenshot at `.expo/aoi-debug/screenshots/2026-10-02T23-01-26-368Z-7mzr88.jpg` showed wheels squeezed into a bottom strip with no Done control. Its native spinner needed an explicit 216-point frame for dynamic sheet sizing. Opening the picker while typing now waits for `keyboardDidHide`, rather than overlapping keyboard dismissal with sheet presentation. The picker stays mounted through native dismissal; the existing NativeSheet close guard prevents duplicate dismissal calls.

Physical-phone captures show the content-sized form at `.expo/aoi-debug/screenshots/2026-10-02T23-04-02-078Z-fesxff.jpg`, the complete picker and Done control at `.expo/aoi-debug/screenshots/2026-10-02T23-04-32-484Z-dct1w2.jpg`, and the restored form after Done at `.expo/aoi-debug/screenshots/2026-10-02T23-05-04-945Z-fzfr4g.jpg`. Opening from a focused partner input also showed the complete picker at `.expo/aoi-debug/screenshots/2026-10-02T23-05-56-453Z-l3jlgf.jpg`. No relationship changes were saved. Static screenshots establish geometry and restored content, not animation frame pacing or VoiceOver behaviour.

The editor/calendar suite passed 118 tests across 10 files. Typecheck, scoped ESLint, accessibility audit, and whitespace checks passed. An earlier full-suite attempt timed out without a result. The subsequent full run passed 2,514 tests across 233 files with two workers, logged at `.expo/crit/relationship-fit-picker-fixed-full.log`.
