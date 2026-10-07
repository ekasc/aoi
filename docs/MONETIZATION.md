# Aoi Plus and preservation

The product contract is a private relationship home built from intentionally shared content. [Relationship home and archive](product/relationship-home-and-archive.md) explains the pivot and the deferred history systems.

## Implemented entitlements

`packages/shared/src/plus.ts` defines Space-level quotas. `features/subscription/subscription-context.tsx` reconciles RevenueCat purchase state with the authoritative backend Space entitlement.

| Benefit | Free | Plus |
| --- | --- | --- |
| Shared media storage | 250 MiB per Space | 5 GiB per Space |
| Unopened future-sealed letters | One at a time | No application count limit |
| PDF chapter keepsakes | Upgrade required | Existing export available with server-confirmed Plus |
| Relationship sky and days together | Included | Included |
| Sky History — rewind the sky to any month | Upgrade required | Available |
| Us, Memories, gallery, existing chapters, everyday resurfacing | Included | Included |
| Plans, responses, Little things | Included | Included |
| Account data export and privacy controls | Included | Included |

One purchase covers both Space members. Storage is not unlimited. Reading older shared memories is not cut off on Free. Recognition is not a paid benefit.

Free: the live relationship. Plus: the complete relationship across time.

The live photo sky, random photo viewing, Memories, and everyday resurfacing are not paid benefits and never open the paywall. Sky History is a Plus benefit. On Free the affordance stays visible and locked, so the reader can see what it is; tapping it opens the existing paywall with a line about this feature and nothing else changed about the shelf.

The paywall displays live store plans and prices. It preselects no plan. Purchase, restore, pending activation, unavailable stores, and empty offerings retain their existing behavior. Missing keys and web report purchasing unavailable rather than granting simulated Plus. Backend status, not client store state alone, grants protected benefits.

## Sky History

Us is a full-screen perspective photo sky. Each available local album photo adds one star, without a 40-star cap. Pinching zooms around the fingers; dragging traverses stars at different depths without changing photos. Double-tapping a star brings it close. A second double-tap returns to overview, and a two-finger tap zooms out one step. Star cores, circular halos, and twinkles stop growing beyond three times their overview size. At close range, a smaller label shows the focused star's album addition date, and tapping that star opens its photo. A dock appears while zoomed in with zoom out, zoom in, and overview controls. Previous and next star controls appear when multiple photos are available and preserve the current close-up zoom. The dock stays above Add and History and hides while the photo viewer or History controls are open. Dates and the dock disappear at overview, where a sky tap still opens a random photo and avoids the previous pick when another is available. Screen-reader actions offer zoom, previous and next star, photo opening, and a return to overview. Web also supports wheel zoom and keyboard navigation (plus/minus, arrows, brackets, Enter, Home). The bottom-right add button matches Memories and stays available on both empty and populated skies. It opens the device picker directly, without a management sheet. Import progress and errors appear on Us. Photos remain device-local; automatic recognition remains inactive.

Us keeps its title, while the sky has no permanent explanatory text. A Plus reader opens the clock icon at the bottom of Us (labelled **Revisit your sky** for screen readers). The track supports dragging, screen-reader adjustments, and Earlier/Later buttons. It includes the relationship's first day, month-end stops, and today. The control is collapsed on a normal launch.

Historical stars and random photo picks include only photos added to the local album by the selected date. This uses the album's `addedAt`, not a claimed camera capture date. The relationship age uses calendar days and months. Letter readiness uses the selected date and never reveals sealed content.

A date with no photos shows an explicit empty message and a return-to-today action. Opening and closing a photo preserves the selection; a fresh launch defaults to today. Memories and Plans keep their own layouts and live data.

Development previews use `/dev-together?variant=sky-free`, `sky-today`, `sky-six-months-ago`, `sky-relationship-start`, `sky-with-content`, or `sky-empty`. Fixture photos are separate from the device album.

## Future preservation services

Richer user-defined chapters, reviewed recaps, capsules, additional keepsake formats, and other archive services are possible Premium additions. None is part of today's purchase promise. They require history reads, ownership and membership rules, storage and restore guarantees, and release policies before sale. Do not invent further premium features to fill this list.

Everyday resurfacing stays free. Sky History moves through months that already happened; it is not a projection of a future date, and it does not version or restore historical sky states. Existing sealed letters are not a separate capsule product.

## Store configuration

RevenueCat uses entitlement `plus`, unless `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID` overrides it. Store credentials remain outside source control. Platform public SDK keys use `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`.

Monthly and annual offerings come from the configured store. The prices in `/dev-paywall` are preview fixtures, not fallback production prices. Purchases are disabled in that preview. `/dev-paywall?state=plus` previews the active-plan screen.

The existing RevenueCat webhook and Space entitlement APIs remain authoritative. This pivot changes no backend quotas, billing integration, native dependencies, encryption, or service deployment. Store purchase and backend export checks still require configured services and a device build.
