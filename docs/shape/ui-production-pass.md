# UI production pass

Preserve the sky arrival, native system sans, existing Feed/Gallery switch, and real user data. No backend changes, native builds, deployments, commits, or phone seeding.

## Sequence

- [x] Read operating principles and current design tokens. PRODUCT.md's serif guidance is stale; the approved system sans and constants/typography.ts take precedence.
- [x] Inspect Story, composer, and memory responses in the browser.
- [x] Fix observed response-composer and feedback gaps, with regression tests.
- [x] Inspect Plans and Space before choosing their changes.
- [x] Verify affected browser flows, screenshots, typecheck, lint, accessibility, and tests.

## First findings

- Response composition shares a URI between photo and voice, so changing kind can submit the wrong media.
- Word responses have a 400-character API limit but the field does not expose or enforce it.
- The response composer remains editable/dismissible while sending; a late completion can clear newer work.
- Responses use secondary text color for typed input rather than the primary content color.
- A failed response read with retained rows offers Retry without displaying its error.
- Dark-mode sheets retained the library's white default background. Fix Root Causes changed the implementation choice: theme the shared NativeSheet rather than recolor individual response controls.
- Photo responses rendered only a text label. They now render the image through the existing authenticated image-source helper, with failed-load feedback and Retry.
- The memory editor allowed Cancel/native exit during its durable save. It now blocks those exits and disables editing until the save completes.
- Space shared a plain code while setup shared an app-opening invite link. Both now use the existing inviteMessage contract.

## Changes delivered

Photo, voice, and word drafts stay separate within the open memory. Failed sends retain the draft; successful sends clear only the submitted kind. Word responses expose and enforce the 400-character limit. A recorded voice response can be listened to before sending. Sheets cannot be dismissed during sending or an active voice recording, and a second send cannot start while one is in flight.

The response sheet scrolls within the viewport and uses keyboard inset adjustment. Input uses the primary text token. Shared sheets use the theme surface, including the existing memory-discard confirmation. The original Feed/Gallery control, arrival, primary labels, and typography are unchanged.

Added a development-only /dev-space preview, with an optional waiting=true state, for repeatable hub inspection without changing phone data. It redirects home in production and has no link in the app UI.

## Verification

- Final full suite: 2,326 tests across 214 files passed, with at most two workers.
- App typecheck, scoped lint, accessibility audit with zero findings, and git diff --check passed.
- Browser: word response submitted and rendered; 400-character native web input attribute checked; photo picked through Expo's web input, submitted, and rendered with its accessible name; nonempty composer Cancel / Keep editing retained the draft.
- Screenshots inspected directly for dark and light response sheets, the 320x568 word composer, the dark discard confirmation, the empty Plans month, waiting Space, and a portrait photo response.
- Space share payload captured in the isolated browser. It contained the app link and fallback code. Native system sharing and receiving-device link opening were not tested.
- Headless file selection needed suppression of Expo's synthetic chooser-opening click, then agent-browser upload to the real file input. The production picker and handler were unchanged.
- Browser session closed; no test/typecheck/lint processes remained in the process check. No servers were started.
- Browser previews use isolated stub storage. Native keyboard, recording permission/start/stop, dismissal locks, VoiceOver, and real-phone performance remain unverified. The new private-detail error UI and paywall were not exercised in this phase.

## Next phase

Continue with Plans creation/suggestion flows, private-detail read-error recovery, Space/account confirmations, and the paywall in the same light/dark and small-screen matrix. Photo responses still lack fullscreen viewing; protected photo fetches need a real-session device smoke test. Do not treat this first interaction pass as completion of the entire production UI review.

## Phase two

- [x] Add recoverable private-detail reads.
- [x] Make paywall plan selection and operation feedback truthful during purchase, restore, and plan reload.
- [x] Guard destructive account confirmations during requests and keep errors inside the sheet.
- [x] Inspect Plans creation source and exercise the suggestion editor. Confirmed-event creation remains a separate runtime gate.
- [x] Run targeted and full regressions, static checks, and isolated browser checks. Native store transactions and destructive phone actions are out of scope.

### Delivered

Little things now has Try again after a failed read. Retried reads distinguish loading from empty and preserve previously loaded details when refresh fails. Saving is unavailable until the read succeeds, so a failed initial read cannot disappear behind a newly added row.

The paywall keeps plan selection fixed during operations, distinguishes Purchasing from Restoring, offers Retry plans for an unavailable/empty offering, and blocks a second purchase while activation is pending. Unexpected operation failures release the controls and show safe errors. Prices, entitlement rules, and purchase-selection policy are unchanged.

Destructive confirmations disable both actions and native dismissal while running. Duplicate calls are guarded immediately, failures remain inside the confirmation for retry, and long content scrolls within the viewport. The content has a labelled dialog role. The underlying Expo web sheet also creates an unnamed enclosing dialog; nested-dialog semantics and native VoiceOver still need a dedicated accessibility pass.

Suggestions guard duplicate submissions and Cancel during submission, use the shared title limit, and expose selected labels as checked radio options. Live browser inspection exposed that React Native Web does not translate accessibilityState.checked in this installed version. Explicit aria-checked props now accompany native state in the changed paywall and suggestion controls. This is runtime evidence that static audit and mocked accessibility tests are not sufficient.

Development-only /dev-paywall, /dev-little-things, and /dev-proposal routes support repeatable inspection. Paywall prices and purchase results are preview fixtures, not live offerings; it cannot charge or grant Plus. Little things and proposals use their real providers against isolated browser stub storage. All three routes redirect home in production and are not linked from the app.

### Verification

- Final full suite: 2,337 tests across 214 files, at most two workers.
- App typecheck, scoped lint, accessibility audit with zero findings, and git diff --check passed.
- Browser: private-detail read failure injected only into the browser Storage.getItem function, then restored before Try again. The real provider recovered to No details yet without navigation.
- Browser: empty paywall offering reloaded to selectable plans; Monthly/Yearly live aria-checked values followed selection; preview purchase error and no-active-purchase restore notice rendered; pending activation disabled both plan choices, purchase, and restore.
- Browser: suggestion title and label selection worked; Date was the only checked radio after selection. Submission ran against the local preview provider, but the preview has no real back stack and emitted GO_BACK not handled. Real navigation after submit remains unverified.
- Browser: deletion confirmation opened, stayed readable at 320x568, and closed with Escape. No account deletion, leave, real purchase, or refund was performed.
- Light/dark paywall, failed private-detail read, suggestion editor, and small-screen deletion confirmation screenshots were read directly.
- No native keyboard/date picker, store transactions, actual subscription reconciliation, VoiceOver, or real-phone request/dismissal behaviour was verified. Confirmed calendar-event creation still needs runtime verification.
- Metro was absent on 8081. An isolated web-only server on 8082 ran with phone seeding disabled and a bounded lifetime. It was relaunched to register the new routes and again to remove CI mode's stale bundle behaviour. Only this owned process group was terminated. Browser session closed afterward.

## Phase three

Confirmed-event creation now guards duplicate saves immediately, disables editing and Cancel during the durable save, and blocks navigation removal through the shared usePreventLeave hook. Success releases that guard before navigating back. Failure preserves the draft and presents a safe Retry message. Checkbox and label states have explicit web aria-checked values alongside native accessibility state.

A failing regression test exposed a related web repository bug: failed writes mutated the cached event rows before storage succeeded. Mutations now operate on copied rows and publish the cache only after persistence. A failed insert leaves zero events; retry creates exactly one.

Photo responses now open the existing fullscreen viewer. Their thumbnail is decorative inside a labelled button. The viewer omits Open memory when already opened from within a memory response. Fullscreen images use imageSourceForUri, including its API-origin and authentication-header rules, rather than a raw URI. Failed loads have Retry photo. No protected URL or credential is logged.

Development-only /dev-new-event and /dev-response routes render the real providers for isolated browser checks. The response route has a fixture memory, but no automatically seeded responses. Neither route is linked from app navigation or available in production. Phone storage and seed flags were untouched.

### Verification

- Final targeted suite: 47 tests across four files. Earlier targeted media/viewer checks: 89 tests across ten files.
- Final full suite: 2,341 tests across 214 files, at most two workers.
- App typecheck, scoped lint for the event editor, response exchange, preview routes, and web repository, accessibility audit with zero findings, and git diff --check passed.
- Viewer lint failed with 50 errors and three warnings. Running lint on both committed viewer files through stdin produced the same counts and rules. These are existing Reanimated shared-value immutability findings and hook/unused-variable warnings, not new failures. They remain unresolved.
- Browser at 320x568: event title, checkbox and radio state, readable form/footer, and failed-save draft retention. A browser-only Storage.setItem failure produced the safe error. After restoring storage, Retry persisted exactly one event with the tested title. The form's inner scroll container exposed the error above the footer. Light and dark screenshots were read directly.
- Browser: injected one photo response into isolated browser storage, opened it fullscreen, inspected the settled image, and closed it. Dispatched a fullscreen image error, inspected the dark Retry/Close state, retried, and closed. This proves rendered recovery controls, not real protected-media authorization or native zoom gestures.
- Unit checks cover duplicate save/Cancel protection, navigation-guard release before success, safe failure/retry, no cached failed insert, photo-response viewer opening/closing, and omission of the redundant memory navigation action. The shared test TextInput mock does not prove native edit locking.
- No native build, simulator, deployment, real store transaction, real-session protected-media fetch, or phone mutation was performed. Native keyboard/date picker, swipe dismissal, pinch/zoom, Dynamic Type, and VoiceOver remain pending.
- The bounded web-only server on 8082 and browser session were stopped after verification.
