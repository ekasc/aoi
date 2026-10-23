# Store readiness, October 22, 2026

This checkout is not ready to submit. Local fixes are in place, but production configuration, store setup, and native verification remain open. Existing uncommitted product work was preserved.

## Changes in this pass

- Production EAS builds run `eas-build-post-install` to validate client configuration. Missing auth, billing, or legal settings fail the build. Development seed flags, stripped capabilities, and an active stress configuration are also blocked.
- Run `pnpm run release:check` with the production environment exported to check the same rules locally. It reads the process environment, not `.env`. The EAS production profile selects the production environment and explicitly disables stub auth. A passing check validates configuration shape, not credentials or URL availability.
- Legal links now use direct Expo environment references so Metro can inline them. Privacy and terms require HTTPS; support also accepts email. Malformed links and embedded URL credentials are rejected.
- The paywall links to privacy, terms, and store subscription management, explains renewal, and reports failed link opens. Account deletion explains that store billing must be canceled separately. Account legal-link failures are now visible.
- Apple sign-in is enabled in app configuration and its Expo plugin is installed in the plugin list. Photo-save permission text moved to the supported Info.plist configuration.
- The native sheet updates its visibility ref after commit instead of during render. The separate `films` project no longer participates in the app typecheck.
- Unit and integration commands now cap Vitest at two workers. Run verification sequentially on this machine. Use `--max-workers 1` for Expo exports.

## Evidence

| Check | Result |
| --- | --- |
| Initial `pnpm run test:unit` | 2,531 passed; one calendar test timed out under parallel load |
| Calendar file rerun | All 58 tests passed |
| Focused legal, paywall, and sheet tests | All 32 passed |
| API integration project, two workers | 600 passed, 3 skipped |
| Final lint | 0 errors, 11 existing warnings |
| Accessibility audit | 0 findings across 143 files, before the final edits |
| Web production export | Completed to `/tmp/aoi-store-web` |
| Expo config introspection | Generated Apple sign-in entitlement and photo permission text confirmed |
| Release command subprocess checks | Complete fixture passed; production without privacy failed; development hook skipped |
| Typecheck | Initial failures came from the separate film project. The rerun did not complete successfully; no clean result claimed |
| Browser inspection | Failed with preview timeouts and a destroyed execution context; no visual acceptance claimed |

The last small edits to account link errors, paywall retry error clearing, and permission placement were not followed by another full suite. Heavy checks were stopped after the user reported RAM pressure. No test/export workers from this pass remain running. No native build, simulator launch, publication, credential write, commit, or push was performed.

## Submission blockers

1. Supply and verify the production EAS environment. This shell had no exported release configuration. Required keys are listed by `pnpm run release:check`; no private credentials should be placed in `EXPO_PUBLIC_*` variables.
2. Publish actual privacy, terms, support, and account-deletion pages. Enter their URLs in the appropriate store listings. Google requires an external account-deletion request path as well as the in-app flow. Do not substitute an unverified domain or a placeholder policy.
3. Configure paid Apple distribution, Android signing and FCM, production OAuth registrations, RevenueCat products and offerings, and webhook credentials. Verify purchase, cancellation, refund, restore, and partner entitlement propagation with store sandbox accounts.
4. Build signed iOS and Android releases and test sign-in, invitation joining, memory creation/upload/retry, playback, deletion, notification delivery, and subscription management. Include iPad because `supportsTablet` remains enabled. No device acceptance was performed here.
5. Inspect the release archives for privacy manifests and required-reason API declarations. Review export-compliance answers for the app's own encryption; this pass does not establish that the current exemption declaration is correct. Verify Android target SDK and native library compatibility in the generated release.
6. Complete App Privacy, Google Data safety, content ratings, screenshots, review access instructions, and subscription metadata using actual behavior. Do not reuse the older checklist's unverified data-collection claims.
7. Verify the deployed backend uses these fixes and has all five rate-limit bindings. The local production route table now excludes test authentication and limiter failures deny requests. Deployed configuration and behavior remain unverified.
8. Finish the full unit suite in bounded batches and inspect rendered screens before cutting a release. The follow-up below records clean app and API typechecks.

## Store references checked

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Google account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)
- [Google Play target API requirements](https://developer.android.com/google/play/requirements/target-sdk)


## Readiness audit follow-up

The backend security pass fixed three confirmed defects.

- Test sign-in is mounted only by the isolated E2E server. The production app no longer imports its router. An HTTP regression proves that even an enabled test flag and matching test credentials cannot mint a session through production composition. Isolated E2E sign-in still mints a working authenticated session.
- Rate limiting now denies missing production bindings, throwing providers, rejected bindings, and unexpected service failures. Local development and the test harness explicitly permit missing bindings. This intentionally trades availability for enforcement during limiter outages. The permissive fallback's unbounded in-memory key map was removed.
- Memory create and update limit titles to 500 and bodies to 10,000 characters. Calendar writes limit titles to 500, actor names to 128, locations to 1,000, and reminders to ten nonnegative integer offsets up to one year. Upload intents limit filenames to 255 and MIME types to 127 characters. Existing stored records are not truncated. The old input-size tests now exercise the actual shared schemas. An authenticated HTTP test proves oversized memory writes return 400 and leave storage empty.

Release validation now checks the platform-specific public RevenueCat key prefixes and rejects E2E authentication configuration on the worker. `pnpm run release:check -- --worker` validates an explicitly exported worker environment without printing its values. This is a configuration check, not proof of the deployed environment or valid credentials.

The app typecheck excludes the independently configured API package. CI already runs the API's own typecheck. Checking those projects separately avoids loading both React Native and the full backend type graph into one TypeScript process. Test and watch commands now default to one worker.

Follow-up verification ran sequentially:

| Check | Result |
| --- | --- |
| Rate-limiter regression tests | 5 new expectations failed before the fix; all 9 tests passed afterward |
| Production schemas and validation | 120 tests passed across 5 files |
| App legal, paywall, and sheet tests | 33 passed together; final release-validator rerun passed all 16 tests |
| Authentication, memory write bounds, and app composition integration | 25 passed across 4 files |
| API typecheck | Passed with a 768 MB V8 heap cap |
| App typecheck after separating API | Passed with a 768 MB V8 heap cap |
| Targeted implementation lint | 0 errors, 7 existing test-harness warnings |
| Full unit suite with a 512 MB per-process heap cap | Exceeded the cap and was stopped; no full-suite pass claimed |

No native build, browser, deployment, or credential change was needed for this follow-up. The external submission blockers above remain open. Production CORS is still a placeholder in `packages/api/vite.config.ts`; replace it with the verified app origin before deployment. No claim about hosted policies or live store credentials was made.

## Later reliability and first-use verification

The [reliability verification](2026-10-22-reliability-verification.md) records the subsequent lifecycle fixes, small-screen setup repair, anniversary date fix, calendar read freshness and sampled rendered review. Its final app sweep passed 2,121 tests across 226 files; shared/API units passed 453 tests and integration passed 603 with three skipped. App/API typechecks pass, repository lint has zero errors and 11 existing warnings, and strict static accessibility has zero findings. Checks ran sequentially under bounded heaps. This closes the earlier bounded-unit and sampled-rendering gaps, while physical pairing, native release verification and the external submission blockers remain open.
