# Performance audit and local stress results

The production-shaped workload follow-up below supersedes the small-seed performance conclusions. It uses populated backend tables, real remote repositories, large media fixtures, and mixed reads and writes.

## Production-shaped workload follow-up

**Correction for the original native runs.** The user switched away from the app two or three times during testing. Foreground continuity was not recorded in those runs. Their native latency and frame-gap numbers are contaminated observations, not confirmed foreground freezes or valid performance-budget failures. Backend latency and integrity results are unaffected. The runner now records AppState transitions and rejects a run that begins inactive or leaves the foreground, even if it later resumes.

### Foreground-verified native repeat

The heavy workload was repeated after adding foreground tracking. The record shows `initialState: active`, no AppState transitions, and `valid: true` across the captured workload. Identities and fixture URLs were fresh for this run.

With a 20,000-memory backing archive and 2,000 memories loaded on the phone:

- Pagination took 45.8 seconds across 19 additional pages. The slowest page took 6.40 seconds.
- Refresh produced a 1.35-second worst JS callback gap.
- The first feed scroll-to-top produced a 2.66-second gap. A later return-to-top produced 249 ms, so the cost was not constant.
- Switching to Lists produced a 2.51-second gap.
- Opening 1,000 letters produced a 2.42-second gap.
- Opening the year view produced a 293 ms gap.

All functional steps completed. This continuously foregrounded run failed the diagnostic performance budgets. Backgrounding cannot explain these recorded intervals. They remain development-build JS callback gaps, not a native GPU trace or release-build result. Their individual causes are not isolated yet.

Evidence: `.expo/aoi-debug/performance/prodlike-heavy-1791875659040/report.json`. The controller restored the neutral config, removed the foreground listener, and stopped its backend after the run.

Two synthetic profiles now exist in `packages/api/src/stress-server.ts`:

- Established: 5,000 memories spanning five years, 2,000 events, 50 lists, 5,000 items, and 200 letters for the active couple. Fifty couples populate the database with 44,200 total memories before workload writes.
- Heavy: 20,000 memories, 10,000 events, 100 lists, 20,000 items, and 1,000 letters for the active couple. One hundred couples populate the database with 119,000 total memories before writes.

These are workload assumptions, not observed customer distributions. Memory bodies vary in length. Two authors contribute notes, photos, and voice traces. Images are 1024 by 768 JPEGs of about 480 KB each. Voice fixtures are 15-second WAV files of about 480 KB each. Current runs use a unique namespace for every identity, space, and media URL, preventing reuse of earlier test caches and trust records.

The backend runs production Hono handlers over HTTP and the real SQLite migration schema through the D1 substitute. Each API request has an additional 60 ms delay, and media requests have 80 ms. It is not Cloudflare D1 or R2 capacity testing. Media fixtures exercise HTTP transfer, decoding, and rendering, not encrypted photo upload or archive decryption.

### Native results with populated archives

Both successful native runs used normal remote repositories, a real authenticated test session, and real cursor pagination. The app began with 100 memories and loaded another 19 pages to reach 2,000 unique memories. The backing archives remained 5,000 and 20,000 memories respectively.

The established run used fresh namespaced URLs and identities. Results:

- Loading the 2,000-memory window took 41.9 seconds. The slowest page took 3.79 seconds.
- Refreshing that window produced a 1.61-second worst JS callback gap.
- Returning to the top of the feed produced a 2.47-second gap.
- Opening the 200-letter archive produced a 617 ms gap.
- Switching to Lists produced a 566 ms gap. Returning to Memories produced a 503 ms gap.
- Opening the year view produced a 325 ms gap.

Its backend recorded 855 photo requests and 86 audio requests from the app. The heavy successful run recorded 93 photo requests and 70 audio requests, consistent with a warmer fixture cache. The request counts are not a byte-transfer or decode-time measurement.

The successful heavy run used the earlier stable media addresses, so some media may have been cached from a preceding attempt. Results:

- Loading the 2,000-memory window took 41.3 seconds. The slowest page took 4.01 seconds.
- Feed return-to-top produced a 3.67-second gap.
- Opening the 1,000-letter archive produced a 2.94-second gap.
- Switching to Lists produced a 1.65-second gap.
- Refresh produced a 971 ms gap. Opening the year view produced a 328 ms gap.

Functional steps completed. The timing verdict is withdrawn because app backgrounding can pause frame callbacks and inflate elapsed pagination time. These observations need a foreground-verified rerun. The tests use real native list refs rather than injected finger gestures. Rendering spans, image decode, native commit, and development overhead have not yet been separated causally.

The native feed continued normal pagination during the scenarios, finishing with 2,100 memories in the established run and 2,200 in the heavy run. The larger final tree is therefore not evidence of a leak by itself.

An earlier attempt to load a 5,000-memory native window did not finish within 90 seconds. Server requests show active pagination and media retrieval. That attempt is recorded as incomplete, not as a passing benchmark. The runner now retains intermediate progress on failure.

### Mixed backend workload and integrity

Each full API run sends 1,640 requests across concurrency levels of 1, 10, 50, and 100. Twenty percent are idempotent memory creates. A third of requests target the large active archive; remaining requests exercise other couples. Reads cover memories, lists, calendar ranges, and letters.

The established mixed run at 100 concurrent clients recorded p95 230 ms and p99 232 ms, with no HTTP failures. The heavy run recorded p95 252 ms and p99 258 ms, with no HTTP failures. Those totals include the injected delay. They are local-backend observations, not sustainable production throughput guarantees.

Before writes, complete cursor traversal returned all 5,000 or 20,000 seeded memories without duplicates. Each full run then created 328 memories, read back every created ID through the authenticated API, and checked 20 repeated creates for idempotent replay.

The UI-only runs skip the mixed request ramp but retain complete backend pagination checks. This keeps heavy device measurements separate from artificial concurrent client traffic.

### Browser result was not accepted

The established browser run collected large-feed timings, including a 1.04-second gap. Its screenshot also showed an uncaught `expo-font.renderToImageAsync` error overlay. Direct-handler automation reached the app beneath that overlay, so its functional `ok` field was insufficient. Do not treat those browser timings as a validated visible user flow.

The browser runner now rejects that overlay. The native results above are the accepted large-data evidence. The browser screenshot and its textual snapshot remain retained so this limitation is inspectable.

### Tools, safety, and verification

`scripts/stress-prodlike.mjs` creates a fresh database, runs workloads, enables the optional client profile, restores the neutral config, and requests backend shutdown in `finally`. The backend has a ten-minute maximum lifetime. All started stress servers and browser sessions were confirmed stopped after testing.

`features/dev/local-stress-config.json` is back to `null`. The development-only adapter accepts private HTTP destinations and synthetic `@stress.invalid` identities. Production mode cannot activate it. Synthetic sessions remain in memory. Tests prove that hydration does not read, replace, or delete the stored credentials. Normal mode still uses the existing session and repositories.

The rerunnable diagnostic budgets are a maximum JS gap of 100 ms and a maximum pagination step of 500 ms. `scripts/stress-assess.mjs` separates functional completion from these performance limits and refuses to grade native timings without valid foreground continuity. The old native reports are invalid for that comparison; the foreground-verified repeat failed the budgets. These are development diagnostic budgets, not release certification.

```sh
node scripts/stress-prodlike.mjs --profile established
node scripts/stress-prodlike.mjs --profile heavy
node scripts/stress-prodlike.mjs --profile heavy --host <private-LAN-IP> --device
node scripts/stress-prodlike.mjs --profile established --host <private-LAN-IP> --device --ui-only
node scripts/stress-prodlike.mjs --profile established --web
node scripts/stress-assess.mjs <path-to-report.json>
```

Keep the phone foregrounded and unlocked for device runs. Run the profiles sequentially. The controller refuses to overwrite an already-active client stress config. The JSON file must remain `null` outside a run.

Evidence under `.expo/aoi-debug/performance/`:

- `prodlike-established-1791872562784/report.json`: established mixed API results and rejected browser run.
- `prodlike-heavy-1791872955117/report.json`: heavy mixed API results, verified writes, and incomplete native attempt.
- `prodlike-heavy-1791873218426/report.json`: successful heavy native run with a 2,000-memory loaded window.
- `prodlike-established-1791873735892/report.json`: successful established native run with fresh fixture URLs.
- Each run retains its populated database, manifest, request records, and backend log.

Final verification after foreground tracking: 2,447 unit tests passed, with the same pre-existing `expo-sharing` failure. Integration tests passed 588, with three skipped. App and API typechecks passed. Explicit lint on the touched code passed. The 19 focused foreground, stress-safety, and budget-assessment tests passed. Repository lint had zero errors and 12 warnings; the accessibility audit had zero findings.

The foreground-verified repeat confirms large JS stalls under this workload. The next step is attribution of the feed, Lists, and Letters costs, rather than more timing guesses. Preserve these datasets and rerun the same workloads after each repair. A passing functional action is not a passing stress test.

### First repair landed: list previews in one pass

The Ours screen asked the collections repository for one list at a time. Every call read and parsed the whole collections document, and the shelf counts separately scanned every item once per shelf.

`listPreviews(collectionIds)` now serves every shelf from one read and one pass. The shelf-count scan is also a single pass over the items. `listItems` is unchanged and still serves the list detail screen.

Measured on the desktop fixture of 100 lists and 10,000 items, with storage mocked so only parse, filter, and sort are counted:

- Previous fan-out: 396 ms, 101 full reads of a 1.75 MB document.
- One-pass replacement: 5.04 ms, 1 full read.

The equivalence test asserts that the previews from the one-pass path equal the previews the per-shelf reads produced, so the speedup is not a correctness trade. A second test pins the read count at one, because one read per screen is the invariant that was broken.

Not yet verified: the on-device effect on the Lists tab, which still needs a foreground-verified run. The desktop fixture measures the store read in isolation and says nothing about the remaining render and network cost of that screen.

### Second repair: remote previews in one request, and the pagination merge

The remote path had the same fan-out shape. `listPreviews` now reads `GET /v1/spaces/current/collection-previews`, which answers for every shelf in the space from two bounded queries: counts grouped by status, and the leading three items per shelf numbered by a window function. One request replaces one per list. Three domain tests cover position ordering, per-shelf and per-space partitioning, and removal; three repository tests pin the request count at one, the mapping onto every requested shelf, and the no-op when nothing is asked for.

The repository test asserting a single request is the durable form of the fix: the per-list round trip is what regressed, so the request count is the invariant worth pinning.

Pagination was doing more work than it needed. Every page merged into the loaded window and re-sorted the whole thing, and each comparison in that sort parsed two dates. `appendOlderPage` now prepends when it can prove the page is safe, and falls back to the general merge otherwise.

The proof is not age ordering. A partner can redate a row already in the window, so a page can arrive claiming an id this side still holds under an older date. An earlier draft of the guard assumed age ordering ruled that out and a test caught it producing a duplicate key. The shipped guard compares ids directly, which is a set lookup per held row.

Measured on a 2,000-record window and a 100-record page:

- General merge: 0.915 ms per page.
- Fast prepend: 0.134 ms per page.

It is correct and it removes real redundant work, but it is about 15 ms across 19 pages. It does not explain and will not fix a 45.8-second pagination. Report it as a small, safe cleanup rather than a performance result.

Nothing here is verified on the device yet. Both changes need the foreground-verified heavy run before any claim about the Lists tab or pagination time.

### The largest unexamined lever: the feed list has no explicit window

The year view's virtualization settings are already conservative, which is why tuning them is a dead end. The Memories feed is the opposite case. Its `FlatList` sets no `windowSize`, `initialNumToRender`, `maxToRenderPerBatch`, or `removeClippedSubviews`, so it runs React Native's defaults, and the default window is 21 viewport heights.

For a feed of photo and video rows that is a large amount of mounted content, and it is consistent with both the multi-second scroll gap and the 1.35-second refresh, since a refresh changes the list and the whole window reconciles. It is not consistent with the paging time, which is about data rather than mounting.

This is the next measured experiment, and it is the one the plan's phase-3 wording already proposed for the feed. Change it one property at a time, keep the fixture and the foreground record, and watch for blank areas during a fast scroll, which is the cost of a smaller window.

## Original small-seed audit

Audit recorded on 2026-10-13 UTC. No application behavior was changed. New runners and tests make the checks repeatable. Incorrect prior profiling claims were corrected in `AGENTS.md` and the phase timer's documentation.

## Verdict

The seeded development app completes the exercised flows, but navigation and calendar transitions do not meet a smooth-interaction standard. The strongest scaling finding is repeated full-store parsing in Lists. Media also keeps running after its tab loses focus.

These findings do not establish release-build frame rates. The app was a connected iPhone development client, served by local Metro, with `EXPO_PUBLIC_AUTH_STUB_MODE=true` and `EXPO_PUBLIC_DEV_SEED=full`. Its API base was a local LAN address. Authorized API calls reject stub mode. Seed media still uses public remote fixtures.

## Measured findings

### P1. Calendar transitions stall on repeated opens

Two runs each verified six year opens and six closes. The earlier run recorded 161-223 ms worst JS callback gaps on opening and 72-78 ms on closing. The final run recorded 146-272 ms on opening and 68-71 ms on closing. Every open mounted `year-pager`; every close removed it.

The final extended run also verified day drill-in and return twice. Opening produced 109-129 ms gaps. Returning produced 85-175 ms gaps. Agenda, Someday, and Month switches produced 36-80 ms gaps.

Relevant code:

- `app/(app)/(tabs)/plans.tsx` switches between month, year, and day trees.
- `components/calendar/year-pager.tsx:119` mounts the row-virtualized year list.
- `components/calendar/year-section.tsx:98` constructs the week/day cell trees.

The cause is not proven. Prior spans end before JSX construction and exclude child rendering and reconciliation. Async density-read time is not CPU time. Subtracting those spans from a frame gap cannot identify native view creation.

Next check: measure complete component returns and React commits, then compare a controlled cell-tree reduction against the unchanged layout. Do not shrink the list window and accept blank visible months as a performance win.

### P1. Navigation gaps recur across tabs and secondary routes

The final core run verified 20 switches, five visits per tab. Worst JS gaps by destination were:

- Memories: 165-182 ms.
- Us: 116-140 ms.
- Lists: 100-130 ms.
- Plans: 179-187 ms.

The final extended run opened Account, Partner, Letters, Question, Paywall, new-list, new-event, memory composer, and chapter detail. It also checked the legacy Profile and Settings redirects to Account. All intended destinations became active and all returns reached the tabs.

Secondary-route entry gaps were 82-142 ms. Return gaps were 126-273 ms. Feed/Gallery switches produced 42-58 ms gaps in the final extended run. Another run had a 150 ms outlier.

Repeated Reanimated shared-value-read-during-render warnings appeared during navigation. The warning's responsible component and its share of the cost were not isolated. Development logging and instrumentation may inflate these numbers.

Next check: obtain the warning's full application call stack, remove the render-time shared-value reads, and repeat the same transitions without changing navigation or layout. Follow with a release-device measurement before setting production budgets.

### P1. Lists reread and parse the entire local store for every preview

The stress fixture contained 100 lists and 10,000 items. Loading the list index and every preview performed 101 reads of the same 1,750,167-character ASCII JSON blob, about 177 MB of cumulative parse input. The isolated desktop test took 390 ms. An earlier isolated run took 445 ms. Counts and item identities remained correct.

This uses mock AsyncStorage with the real repository parse, validation, filter, and sort logic. It excludes disk and bridge latency. A run concurrent with the broader suites took 1.6 seconds; that result is not used as an isolated timing baseline.

Relevant code:

- `features/collections/use-list-previews.ts:52` runs one `listItems` call per list through `Promise.all`.
- `features/collections/local-collections-repository.ts:94` parses the full shared blob on each read.
- `features/collections/local-collections-repository.ts:143` separately filters all items for each list's count.
- `features/collections/remote-collections-repository.ts:47` makes each remote preview read a separate request.

Next change: return previews and counts with the list index, or derive them from one local snapshot. Index item counts in one pass. Test cache invalidation after edits, not just faster reads.

### P2. Video continues playing on a hidden tab

A seed video reached `playing: true`, `status: readyToPlay` in Memories. After navigating to Plans and waiting another 1.5 seconds, it remained `playing: true`. Active navigation state confirmed Plans. The audit paused the player in `finally`.

Relevant code:

- `components/media/video-player.tsx:36` starts playback when the surface mounts.
- The component has no focus or app-state pause rule.
- `app/(app)/(tabs)/(memories)/index.tsx:1550` deliberately retains Feed and Gallery trees.

Video is currently a preview-only media type. This is a confirmed lifecycle defect in that playback path, not evidence that production video uploads exist.

Next change: pause players when their presentation, screen, or app is inactive. Keep list offsets without retaining active playback.

### P2. Idle voice-note players poll continuously

`hooks/use-voice-playback.ts:50` installs a 400 ms interval for every mounted player, regardless of playback or screen focus. The device tree contained four `AudioPlayerComponent` fibers after warming media. Their exact CPU cost was not measured.

This is a source-confirmed scheduling rule, not a measured battery-drain claim. Retained Feed/Gallery trees mean offscreen players can remain mounted.

Next change: use playback-status subscriptions or gate polling on active playback and visibility. Check background audio policy explicitly.

## Large-data results

`tests/unit/performance/scaling.test.ts` exercises real pure functions and the local collections repository. It asserts preservation and ordering-related invariants, not fixed timing thresholds.

The final isolated desktop run at 10,000 memories recorded:

- Feed grouping: 37 ms.
- Gallery grouping and row construction: 42 ms.
- Photo-sky field construction: 17 ms.
- Sixty nearest-star scans: 11 ms total.

At 1,000 simultaneous calendar events, overlap layout took 3.4 ms and assigned distinct columns correctly. The column search is quadratic in the worst overlap case, but this desktop sample did not show it as the current bottleneck.

These are individual desktop diagnostic samples, with JIT and cold formatter effects. They are not phone-render timings or a 10,000-item native list test. The 100-entry feed sample paid a cold formatter cost and was slower than the warmed 1,000-entry sample.

## Local API burst

`tests/integration/performance-local.test.ts` serves the real Hono app over loopback HTTP. Authentication and queries use the existing SQLite D1 test substitute. Ten batches of 20 concurrent reads cover current space, moments, collections, and letters.

The isolated run completed 200 reads in 431 ms, with p50 30 ms, p95 77 ms, maximum 82 ms, and zero non-200 responses. The test consumes response bodies, bounds requests with timeouts, and closes its server in `finally`.

The dataset is small. This does not measure real D1 network latency, Cloudflare limits, R2 throughput, write contention, or production capacity.

## Other inspected risks and safeguards

- Startup: the served development iOS bundle was 16,411,937 bytes, or 3,001,176 bytes gzip. It contained zero references to the production API hostname. This is not a release Hermes bytecode size or launch-time measurement. `app/_layout.tsx` gates navigation on fonts, theme, session, and space hydration.
- Long collections: Lists, Letters, Partner details, and chapter members use mapped children inside non-virtualized scroll containers. Large collections need native rendering tests. Item detail grids, Memories, and the year/month/day pagers already use virtualization where inspected.
- Archive media: `features/album/protocol-archive.ts:1013` sequentially downloads and verifies every manifest's media, retaining plaintext in the result. `features/album/use-sky-photos.ts:139` repopulates an archive-wide bytes map. This can grow load time and memory with archive size. No large encrypted archive was exercised on the phone.
- Photo sky: nearest-star lookup scans the entire field in `features/home/photo-sky-camera.ts:102`. It runs during zoomed camera changes. The desktop scan benchmark does not account for Skia draw cost or the UI thread.
- API waits: `features/api-client.ts` accepts a caller signal but does not impose a default request deadline. Offline requests and bounded retry behavior need a separate network-failure run. Refresh-token requests already have single-flight coordination.
- Export: media is downloaded one file at a time and ZIP contents stream in chunks. JSON datasets still accumulate and serialize as complete arrays. Native export and share-sheet throughput were not exercised.
- Sky animation: inspected cloud/momentum paths use focus and reduced-motion gates. Beach frame-callback activity after focus changes needs UI-thread verification; source inspection alone is not a GPU or battery audit.

## Coverage and limits

Runtime coverage included all four tabs, year/day/mode changes, Account and its legacy redirects, Partner, Letters, Question, Paywall, new list/event/memory forms, chapter detail, Feed/Gallery switching, native-ref feed scrolling, and seed video lifecycle.

Six native-ref feed scrolls in the final extended run had 17-20 ms worst JS gaps and zero estimated missed 60 Hz callbacks. This is a small seeded list, with programmatic native scrolling rather than injected finger gestures.

The final core and extended loops each ended with the same 18,947 mounted-fiber count they began with. An earlier pre-media run was stable at 14,177. Warming retained media changed the tree between runs. Neither observation proves the absence of a heap or native-resource leak.

The sampler uses `performance.now()` and starts before invoking an action, including the initial callback delay. Its missed-frame count assumes a 60 Hz budget. It measures JS callback cadence, not actual display/GPU frame delivery. Fiber lookup adds roughly several milliseconds to synthetic presses. Native navigation animations can remain smooth while JS is blocked.

Not covered at runtime: release cold launch, native heap/CPU/GPU profiling, background/foreground OS gestures, keyboard typing and dismissal, permission dialogs, auth/account switching, purchases, photo import/recovery/device enrollment, real upload/export throughput, large native datasets, Android, and server failure injection. No content was saved or deleted, no native build or simulator was started, and no cloud service was load-tested.

## Verification

- Unit suite: 2,428 passed, one pre-existing failure in `chapter-photo-stack.test.tsx`, caused by `expo-sharing` EventEmitter initialization in the test environment.
- Integration suite: 588 passed, three skipped.
- Isolated scaling suite: six passed.
- Local HTTP stress test: passed.
- Typecheck: passed.
- Repository lint: zero errors, 12 warnings. Explicit touched-file lint also found the existing unused `STORE_KEY` warning in the phase timer.
- Accessibility static audit: zero findings across 143 files.
- Device scenario runners: final core and extended runs passed every scenario. Media state was read from the native player, then paused.

## Reproduce and evidence

Run with the connected seeded stub device foregrounded and unlocked:

```sh
node scripts/perf-audit.mjs
node scripts/perf-audit.mjs --extended
node scripts/perf-audit.mjs --media
pnpm exec vitest run tests/unit/performance/scaling.test.ts --reporter=verbose
pnpm exec vitest run --project integration tests/integration/performance-local.test.ts --reporter=verbose
```

Run desktop benchmarks separately from the broader suites to avoid contention. The device runner refuses non-stub sessions and requires the full seed for navigation scenarios. `--media` uses helpers installed by the preceding core or extended run. Runners write raw results under the ignored `.expo/aoi-debug/performance/` directory.

Evidence retained for this audit:

- `device-1791868835541.json`: initial core run.
- `device-1791869304641.json`: confirmed hidden-tab video playback.
- `device-1791869810437.json`: final extended run, including day transitions and scrolling.
- `device-1791869920285.json`: final core run with active-tab verification.
- `scaling-isolated.log`, `http-stress-isolated.log`, `unit-tests.log`, `integration-tests.log`, `lint.log`.
- `development-ios.bundle`: development bundle inspected for size and API host references.
- Screenshot `.expo/aoi-debug/screenshots/2026-10-13T05-26-34-363Z-fzf8pe.jpg` and its accessibility sidecar. The image was inspected; it is not a visual acceptance verdict for every route.

Recommended repair order: stop hidden media/polling, eliminate list-preview fan-out, identify the render-time Reanimated reads, then profile repeated calendar and navigation transitions with valid spans. Measure release startup and native resources before making production-performance claims.
