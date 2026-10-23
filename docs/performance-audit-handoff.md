# Aoi performance audit, handoff report

Written for a reader with no access to the repository. Every number here was measured on 2026-10-12 and 2026-10-13.

## 1. What the application is

Aoi is a private app for a couple. It is built with Expo and React Native, written in TypeScript, and runs on Hermes (React Native's JavaScript engine). It uses Expo Router for navigation, React 19.2, React Native 0.86, Reanimated 4 and Moti for animation, and Skia for a graphical "photo sky".

The app has four tabs:

1. **Memories.** A chronological feed of shared memories, with a grid "Gallery" view. Memories carry text, photos, voice notes, and video.
2. **Us.** A "photo sky", a Skia scene where photos appear as stars that can pan and zoom.
3. **Plans.** A calendar with a month grid, an infinite-scroll year view, a day timeline, and agenda and someday lists.
4. **Lists.** Shared checklists, called collections.

Storage is local first. The calendar uses SQLite on the device, lists use AsyncStorage, and the session lives in the platform secure store. A remote backend, a Hono service on Cloudflare Workers with D1 and R2, serves the shared data. A separate encrypted album protocol handles shared photos.

## 2. Why the audit existed

The goal was an app-wide performance audit with local stress testing that approximates production load, then a verdict on whether the app is ready for real archive sizes.

## 3. How it was measured

### 3.1 The device and the harness

Testing ran on a real iPhone development client (bundle `com.ekasc.aoi.dev`) against a Metro development server on the same local network. No simulator, no emulator, no release build.

The app exposes a development-only control surface that is reachable from the host machine over the Metro debugger bridge. It walks the live React fiber tree, finds an element by its accessibility label, and calls the same press handler the operating system would have called. There is no host-side tap injection on a physical phone, so this is how interactions were driven.

Timing came from `requestAnimationFrame` callbacks on the JavaScript thread. The harness records the gap between consecutive callbacks and counts a gap above 25 ms as lost frames against a 60 Hz budget.

### 3.2 Two data worlds

**Small seeded world.** For interaction measurements, the app booted signed in as a seeded couple with a small mock archive. This is fast to iterate on and good for finding per-interaction cost.

**Synthetic production-shaped backend.** To test at scale, a local backend was built that runs the real request handlers over HTTP with the real database schema, backed by a SQLite substitute for D1 and an in-memory substitute for R2. The app talked to it through its normal remote code paths with a synthetic session that was never written to the device's secure store.

Two synthetic profiles were used. They are workload assumptions, not observed customer distributions:

| | Established | Heavy |
|---|---|---|
| Memories in the active archive | 5,000 over five years | 20,000 |
| Calendar events | 2,000 | 10,000 |
| Lists | 50 | 100 |
| List items | 5,000 | 20,000 |
| Letters | 200 | 1,000 |
| Other couples populating the database | 50 | 100 |
| Total memories in the database | 44,200 | 119,000 |

Media fixtures were 1024 by 768 JPEG images of roughly 480 KB each, and 15-second WAV audio files of roughly 480 KB each, served over HTTP. Each backend request carried an injected 60 ms delay, and media requests 80 ms, to stand in for realistic network latency. Every run used a fresh namespace for identities, spaces, and media addresses, so no earlier run's caches could be reused.

### 3.3 Methods that were corrected during the audit

These matter, because they invalidate earlier claims.

1. The first benchmark helper swallowed handler errors and stopped its fiber walk at 6,000 nodes. A failed press could therefore be reported as a clean 60 frames per second. When the helper was fixed and the run verified that each intended screen actually became active, the year view measured slow on **every** open, not only the first.
2. Sampling started only after the action, so the delay to the first callback was missed.
3. No run verified that the intended destination actually became active.
4. No run tracked foreground state. An app switch pauses frame callbacks and inflates every interval. The user confirmed switching away from the app two or three times during the first native runs, which invalidated those timings. Foreground tracking was added and the affected runs were rerun.
5. A CPU profile was not obtainable. The Chrome DevTools Protocol `Profiler` domain answers `Unsupported method 'Profiler.enable'` on this Hermes target, and Hermes' own sampling profiler is not exposed on `HermesInternal`.
6. A development-only phase timer had been instrumented in the year view. Its spans end **before** the JSX is built, so they exclude the cell maps, child renders, reconciliation, and commit. An earlier conclusion that the stall was "native view creation" came from subtracting those spans and is **not supported**. That cause is unconfirmed.

## 4. Findings at small archive size

All gaps below are worst JavaScript callback gaps, in milliseconds, on the development build.

### 4.1 The year view stalls on every open

Corrected measurement, six opens and six closes:

- Open: 146 to 272 ms, with 13 to 29 estimated missed frames.
- Close: 68 to 78 ms.
- 22 mini-months were mounted on each open.

The surrounding Plans screen was measured alone and was clean, 60 frames per second with zero dropped frames and a 17 to 20 ms worst gap. So the cost belongs to the year view, not to the screen that hosts it.

### 4.2 Navigation produces repeated gaps

Twenty verified tab switches, five per destination:

| Destination | Worst gap |
|---|---|
| Memories | 165 to 182 ms |
| Us | 116 to 140 ms |
| Lists | 100 to 130 ms |
| Plans | 179 to 187 ms |

Secondary routes, including Account, Partner, Letters, Question, the paywall, and the new-list, new-event, and new-memory forms, measured 82 to 142 ms on entry and 126 to 273 ms on return. Feed and Gallery switching measured 42 to 58 ms, with one 150 ms outlier.

Repeated Reanimated warnings appeared during navigation, reporting a shared value being read during component render. The responsible component was not isolated.

### 4.3 Lists reread the entire local store for every preview

The Lists screen shows a preview of every list, including its covers and done count. The fixture had 100 lists and 10,000 items in one 1.75 MB JSON blob. Loading the index and every preview performed **101 reads of the same blob**, about 177 MB of cumulative parse input. The isolated desktop measurement took 390 to 445 ms with storage mocked, so disk and bridge time was excluded. Counts and item identities stayed correct.

### 4.4 Media keeps running when it should not

- A seeded video kept `playing: true` after navigating from Memories to Plans and waiting 1.5 seconds. The harness paused it afterward. The video surface has no focus or app-state pause rule.
- Voice notes install a 400 ms polling interval for every mounted player, regardless of whether anything is playing and regardless of visibility. The tree held four such players after warming media. The CPU cost of that polling was not measured.

### 4.5 Desktop-only micro-benchmarks

These are single desktop samples with the JavaScript engine warm, not device timings. At 10,000 memories, feed grouping took 37 ms, gallery grouping 42 ms, photo-sky field construction 17 ms, and sixty nearest-star scans 11 ms. Laying out 1,000 fully overlapping calendar events took 3.4 ms and assigned distinct columns correctly. None of these was the bottleneck in this sample.

### 4.6 Bundle and configuration

The development iOS bundle measured 16,411,937 bytes raw and 3,001,176 bytes gzipped, with zero references to the production API host, which is expected because the dev server was configured offline. This is not a release Hermes bytecode size and says nothing about launch time.

## 5. Findings at production-shaped scale

### 5.1 The backend held up

Full cursor traversal returned the complete archive with no duplicates: 5,000 memories in 50 pages for the established profile, and 20,000 memories in 200 pages for the heavy profile.

Mixed workload, 1,640 requests per run, ramping concurrency through 1, 10, 50, and 100, with 20 percent idempotent writes and about a third of requests aimed at the large active archive. Figures include the injected 60 ms delay.

| Profile | Concurrency | p50 | p95 | p99 | Max | Throughput | Failures |
|---|---|---|---|---|---|---|---|
| Established | 100 | 161 to 187 ms | 230 to 231 ms | 232 to 233 ms | 218 to 240 ms | 522 to 561 req/s | 0 |
| Heavy | 100 | 196 to 206 ms | 231 to 252 ms | 233 to 258 ms | 235 to 476 ms | 477 to 512 req/s | 0 |

Data integrity passed. Each full run created 328 memories, read every created identifier back through the authenticated API, and confirmed that 20 repeated creates replayed the original identifier instead of writing a second row.

None of this is Cloudflare D1 or R2 capacity, and none of it reflects real WAN latency. It establishes that the local backend was not the bottleneck.

### 5.2 The client did not

The heavy profile was rerun after foreground tracking was added. That run recorded `initialState: active`, zero foreground transitions, and a valid foreground record across the whole workload. The archive held 20,000 memories and the phone had 2,000 loaded.

- Loading 2,000 memories took 45.8 seconds across 19 additional pages. The slowest single page took 6.40 seconds.
- Refreshing the loaded window produced a 1.35 second gap.
- The first scroll back to the top of the feed produced a 2.66 second gap. A later return to the top produced 249 ms, so the cost is not constant.
- Switching to the Lists tab produced a 2.51 second gap.
- Opening the archive of 1,000 letters produced a 2.42 second gap.
- Opening the year view produced a 293 ms gap.

Every functional step completed. Every timing budget was violated.

Earlier native runs, before foreground tracking, showed comparable or worse numbers, up to 3.67 seconds for a feed return and 2.94 seconds for Letters. Those runs are contaminated by the confirmed app switches and are not used as evidence. They are consistent with the foreground-verified run rather than contradicting it.

One earlier attempt to load a 5,000-memory native window did not finish inside its 90 second limit. Server request logs show it was actively paging and fetching media, not stalled on connection. That attempt is recorded as incomplete.

### 5.3 A browser run was rejected

A Chrome run collected large-feed timings including a 1.04 second gap, but its screenshot showed an uncaught font-rendering error overlay. The automation reached the app beneath the overlay through direct handler calls, so its self-reported success was not trustworthy. Those browser timings were discarded and the browser runner now rejects that overlay.

### 5.4 Tree size

Mounted fiber counts were stable within each run, from 14,177 in the smallest seeded run to roughly 30,800 at the end of the largest. Counts grew between differently configured runs, so they are not comparable, and none of this proves or disproves a heap or native resource leak. A leak test would need repeated identical cycles with heap measurement.

## 6. Verdict

The application is **not ready for large archives**.

- The bottleneck is the client, at roughly 2,000 loaded memories and 1,000 letters. Multi-second JavaScript stalls of 1.3 to 2.7 seconds occur during refresh, scrolling, and opening the two largest collection surfaces.
- The backend is not the constraint. It served 100 concurrent clients with 20 percent writes, no failures, and 252 ms p95 on the heavy profile, with all writes read back and all repeats deduplicated.
- App switching does not explain the stalls. The decisive run stayed in the foreground with zero transitions and still stalled.

### Recommended repair order

1. Stop hidden media and idle polling. Pause video when its screen is not focused, and replace the unconditional 400 ms voice-note polling with playback-state subscriptions, or at least gate it on active playback and visibility.
2. Remove the list preview fan-out. Return previews and counts with the list index, or derive them from one local snapshot, with a single pass to index item counts. Test cache invalidation after edits, not only faster reads.
3. Virtualize the Letters and list-item surfaces, which currently render mapped children inside non-virtualized scroll containers.
4. Isolate the render-time Reanimated shared-value reads during navigation.
5. Attribute the feed refresh and scroll cost properly, using complete component-return and commit spans rather than the current partial spans, before attempting fixes.

Then rerun the same profiles. A passing functional action is not a passing stress test.

## 7. What was not measured

Treat the following as gaps, not as clean results:

- Release-build performance. Every number is a development build with development overhead.
- Native heap, CPU, and GPU profiles. The timing oracle is JavaScript callback cadence, not display frame delivery, so a native navigation animation can look smooth while the JavaScript thread is blocked.
- Real finger gestures. Scrolling was driven through the native list ref, not by touches.
- Cold launch on a release build.
- Keyboard interaction, permission dialogs, background and foreground OS gestures.
- Authentication and account switching.
- Purchases.
- Photo import, recovery, and device enrollment.
- Real upload and export throughput, and the encrypted album at large archive size.
- Android.
- Cloudflare D1 and R2 behaviour under load, and real WAN latency. The local backend is a substitute.
- Observed customer data distributions. The synthetic profiles are assumptions.

## 8. Evidence and how to reproduce

All artifacts live under `.expo/aoi-debug/performance/` and are gitignored.

Key files:

- `prodlike-heavy-1791875659040/report.json` is the foreground-verified heavy native run.
- `prodlike-heavy-1791872955117/report.json` and `prodlike-established-1791873735892/report.json` are earlier native runs with valid backend results and contaminated native timings.
- `prodlike-established-1791872562784/report.json` holds the established mixed API results and the rejected browser run.
- Each run directory also keeps its populated database, manifest, recorded requests, and backend log.
- `scaling-tests.log`, `http-stress-isolated.log`, `unit-tests.log`, and `integration-tests.log` hold the desktop and suite results.

Reproduce with the device foregrounded and unlocked, running:

```sh
node scripts/stress-prodlike.mjs --profile established
node scripts/stress-prodlike.mjs --profile heavy
node scripts/stress-prodlike.mjs --profile heavy --host <private-LAN-IP> --device
node scripts/stress-prodlike.mjs --profile established --host <private-LAN-IP> --device --ui-only
node scripts/stress-prodlike.mjs --profile established --web
node scripts/stress-assess.mjs <path-to-report.json>
```

The runner creates a fresh database, runs the workload, optionally enables the client profile, restores the neutral configuration, and shuts its backend down in a `finally` block. A started backend has a ten-minute maximum lifetime.

## 9. Verification state at the time of writing

- Unit tests: 2,447 passed, one pre-existing failure caused by a test-environment issue in the photo-stack test.
- Integration tests: 588 passed, three skipped.
- Type checking: clean for both the app and the API package.
- Lint: zero errors and twelve pre-existing warnings.
- Accessibility audit: zero findings across 143 files.
- All test servers and browser sessions were confirmed stopped, and the client test configuration was restored to neutral.
