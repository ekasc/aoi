# Reliability verification, October 22, 2026

Status: this reliability and sampled first-use review batch is complete. This records the current checkout's evidence, not store or physical-device acceptance. Existing uncommitted product work is preserved. Intermediate findings below retain their chronology; the final verification section supersedes their pending statuses.

## Confirmed fixes

- Native sheets now defer a requested reopen until the preceding dismissal commits. The installed Android sheet ignores presentation while its committed state still says open. The regression mock now models that state and proves the reopened sheet remains dismissible.
- Voice recording restores playback mode after completion, cancelled preparation, stopped capture and unmount. It preserves silent-switch playback and keeps capture mode when a failed stop leaves recording active. Actual speaker routing remains a physical-device check.
- Sign-in hero tests no longer require the retired welcome copy or DOM text order. They check the heading accessibility contract and that supplied authentication controls remain actionable.
- Selection animation interruption tests pass with the existing implementation. No selection implementation change was needed.

DeepSeek v4.1 Flash implemented these changes as T3-managed child tasks. Codex inspected the implementation and installed dependency source, then independently ran the checks below.

## Verification

Commands run sequentially, with no native builds or simulators:

```sh
NODE_OPTIONS=--max-old-space-size=512 pnpm exec vitest run --project unit-app --maxWorkers 1 tests/unit/components/native-sheet-lifecycle.test.tsx tests/unit/components/native-sheet-theme.test.tsx tests/unit/components/segmented-control.test.tsx tests/unit/components/voice-recorder.test.tsx tests/unit/components/action-sheet.test.tsx
```

Result: 45 tests passed across five files.

The wider app audit sorts `rg --files tests/unit` test paths, then runs consecutive batches through the same capped Vitest command. The first 168 files passed, totaling 1,642 tests. Logs are `/tmp/aoi-readiness-unit-1.log` through `/tmp/aoi-readiness-unit-7.log`; the machine-readable ledger is `/tmp/aoi-readiness-batches.json`.

The next batch hit the 512 MB worker heap limit. Smaller reruns showed:

- Session, question and response suites: 62 tests passed across ten files.
- Relationship-age hook: three tests passed in isolation.
- Plans Someday: eight tests passed in isolation.
- Plans screen: the isolated file also exhausted the heap after 55 of 58 tests. The last reported completion precedes the mode-switch navigation checks. Diagnosis is delegated; this is not a passing suite or proof of a production leak. Log: `/tmp/aoi-isolate-plans.test.tsx.log`.

The Plans diagnosis found retained React scheduler work in the test environment. Flushing it with asynchronous `act` after each test lets all 58 tests complete under the same heap cap; production Plans code was not changed by this fix. Codex inspected the diff and independently completed the remaining batches.

Before the setup layout fix below:

| Check | Result |
| --- | --- |
| All app unit tests, bounded batches | 2,105 passed across 224 files |
| Shared and API units, one worker, 512 MB heap | 453 passed across 23 files |
| Integration project, one worker, 512 MB heap | 603 passed, three skipped across 42 files |
| App and API typechecks, sequential 768 MB heaps | Both passed |
| Scoped lint on changed implementation/tests | Zero errors, three existing test warnings |
| Strict static accessibility audit | Zero findings across 142 files |
| `git diff --check` | Passed |

Logs: `/tmp/aoi-readiness-shared-api.log`, `/tmp/aoi-readiness-integration.log`, `/tmp/aoi-readiness-app-types.log`, `/tmp/aoi-readiness-api-types.log`, `/tmp/aoi-readiness-scoped-lint.log`. The worker-isolate project was not run. These checks precede the next layout change and must not be presented as its verification.

## Rendered first-use findings

T3 preview navigation succeeded but two snapshots failed with `Preview automation snapshot timed out after 15000ms.` The documented `agent-browser` fallback rendered setup successfully. Metro listens on IPv6 localhost in this environment, so `http://127.0.0.1:8081` refused the connection while `http://localhost:8081` worked.

At 390 by 844, the create/join choices were legible and distinct. At 320 by 568, the identity form's Continue button occupied y=592 to 642 and Back y=654 to 704, outside the viewport, with no scroll path. Sign out overlapped the form. Joining also placed Back below the viewport and Sign out over Join. The code boxes occupied 316 pixels and escaped the form's gutters. Codex directly inspected screenshots `/tmp/aoi-readiness-identity-small.png` and `/tmp/aoi-readiness-join-small.png` and measured the live DOM.

Setup now uses a keyboard-avoiding scroll viewport. Content can grow rather than painting beyond a fixed flex column, and code cells shrink inside the page gutters. Codex verified the rendered result at 320 by 568: the identity viewport scrolls through 774 pixels of content, bringing Continue to y=386–436, Back to y=448–498 and Sign out below the form. Back returns to the choices. The join code row is now x=24–296, inside both gutters; Join and Back are reachable without overlap. Screenshots: `/tmp/aoi-readiness-identity-fixed-small.png`, `/tmp/aoi-readiness-join-fixed-small.png`. DOM scrolling establishes browser reachability, not native finger/keyboard behavior.

Post-setup verification: 166 tests passed across 25 affected setup, space, navigation and provider-auth files; app typecheck and scoped setup lint passed; strict accessibility audit again found zero issues across 142 files. Log: `/tmp/aoi-readiness-final-setup.log`. The full-suite counts above precede the setup change; they were not rerun wholesale afterward.

Rendered samples also checked the first-memory prompt, opening and dismissing the invitation, Account help, empty Lists, empty Agenda and empty Us. Each has an explicit action. Us retains the sky, explains its separate photos and states encryption/sharing behavior. These development previews do not include the real bottom tab navigator. No production account or media picker was exercised. Development Reanimated warnings about shared-value reads remain visible and were not treated as native performance measurements.

Further review:

- Account's calendar-date formatter is fixed through the existing local-date parser. Boundary tests cover Vancouver and Tokyo, timestamps, and absent/unreadable input. Its final rendered recheck is pending.
- Plans now has an explicit successful-empty status and composer action. The first implementation counted events, dated goals and monthiversary marks, and preserved loading/error distinctions. Codex independently passed 157 Plans, relationship and navigation tests across 15 files, plus app typecheck. Log: `/tmp/aoi-readiness-final-plans.log`.
- That implementation is not accepted yet: the pager renders seven months while the provider reads only the visible month and its two neighbours. Codex found that the new empty branch could infer emptiness for unqueried pages. Provider inspection also found that an earlier request can write its events after a later month is selected, before the caller's cancellation check. A further scoped task is adding loaded-window/request freshness and deferred-read regressions. Rendered calendar recheck and final verification await that fix.

The loaded-window/request fix is implemented. A monotonic request identity rejects older responses, loading derives from the requested month and delivered window, and Plans requires `monthReadState(month) === 'loaded'` before claiming empty. Codex independently passed 274 affected tests across 23 files and app typecheck. Log: `/tmp/aoi-readiness-calendar-final.log`.

Review found a further stale-callback case: a mutation awaiting its repository write retains an earlier `reloadAfterMutation`, which can start a new read for the old month after navigation. A final scoped task is proving and fixing that path, keeping late refreshes attached to the current committed month and invalidating completions after unmount. The native and rendered acceptance limits remain unchanged.

## Accepted calendar and date fixes

The delayed-save regression failed before the fix and passes afterward. Post-mutation reloads and retained refresh callbacks now read the committed visible month through a layout-synced ref. Month read completions also check whether the provider remains mounted. Codex independently passed 287 affected tests across 26 files and app typecheck on this combined implementation. Scoped lint passed after adding a narrow, explained exemption for the existing external-repository hydration effect. Static accessibility remains at zero findings across 142 files. Logs: `/tmp/aoi-readiness-accepted-calendar.log`, `/tmp/aoi-readiness-accepted-types.log`.

Final browser recheck confirmed:

- Account displays June 14, 2022 in `America/Vancouver`, matching the saved date. Screenshot: `/tmp/aoi-readiness-account-date-fixed.png`.
- An empty January 2022, before the preview couple's start date, shows its explicit status and labelled create action. The status and action fit at 390 by 844 and 320 by 568 without obscuring calendar rows. Screenshots: `/tmp/aoi-readiness-calendar-empty-fixed.png`, `/tmp/aoi-readiness-calendar-empty-fixed-small.png`.
- The create action leaves the development preview for the protected editor route. Web auth then redirects to sign-in; the destination date is verified by the behavioral navigation tests, not by claiming a successful live editor session.

The fallback browser and Metro server were closed normally after inspection. No native build, device, live account, purchase or production service was exercised.

## Final verification

| Check | Final evidence |
| --- | --- |
| Combined app unit sweep | 2,121 passed across 226 files, in 15 sequential batches of at most 16 files, one worker and a 512 MB heap |
| Shared/API unit projects | 453 passed across 23 files earlier in this batch; their source was unchanged by the later app fixes |
| Backend integration project | 603 passed, three skipped earlier in this batch; backend source unchanged afterward |
| App typecheck after final calendar fix | Passed with a 768 MB heap |
| API typecheck | Passed earlier in this batch; API source unchanged afterward |
| Repository lint | Zero errors, 11 existing warnings |
| Strict static accessibility | Zero findings across 142 files |
| Diff whitespace check | Passed |

Final app sweep ledger: `/tmp/aoi-final-unit-batches.json`. Logs: `/tmp/aoi-final-unit-1.log` through `/tmp/aoi-final-unit-15.log`. Repository lint log: `/tmp/aoi-readiness-final-full-lint.log`. The worker-isolate project and signed native release builds were not run. No commit, push or deployment was performed.

Remaining gates are the owner's physical two-phone run, native keyboard/gesture/audio/permission/notification checks, production service configuration, store billing validation, signing, policy pages and submission metadata. The sampled browser layouts establish neither native performance nor a completed end-to-end paired session.

The temporary Metro server, fallback browser session and T3 preview tab are closed. No physical-device acceptance is claimed.

## Physical checks retained for the owner

- Repeatedly dismiss and reopen a sheet, including a reopen during its closing animation. Confirm it opens and can still dismiss on each platform.
- Record and stop a voice note, then play one. Check speaker/headphone routing and the iPhone silent switch. Repeat after cancelling recording and leaving the composer.
- Continue the full first-use and two-phone run in [first-use acceptance](../product/first-use-acceptance.md).

No live account, purchase, deployment, signing or credential operation was performed. Store blockers in [store readiness](2026-10-22-store-readiness.md) remain open.
