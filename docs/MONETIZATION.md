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
| Us, Memories, gallery, existing chapters, everyday resurfacing | Included | Included |
| Plans, responses, Little things | Included | Included |
| Account data export and privacy controls | Included | Included |

One purchase covers both Space members. Storage is not unlimited. Reading older shared memories is not cut off on Free. Recognition is not a paid benefit.

The paywall displays live store plans and prices. It preselects no plan. Purchase, restore, pending activation, unavailable stores, and empty offerings retain their existing behavior. Missing keys and web report purchasing unavailable rather than granting simulated Plus. Backend status, not client store state alone, grants protected benefits.

## Future preservation services

Deeper archive services, historical sky states, richer user-defined chapters, reviewed recaps, capsules, and additional keepsake formats are possible Premium additions. None is part of today's purchase promise. They require history reads, ownership and membership rules, storage and restore guarantees, and release policies before sale.

Everyday resurfacing stays free. The current date projection for a sky is not versioned time travel. Existing sealed letters are not a separate capsule product.

## Store configuration

RevenueCat uses entitlement `plus`, unless `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID` overrides it. Store credentials remain outside source control. Platform public SDK keys use `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`.

Monthly and annual offerings come from the configured store. The prices in `/dev-paywall` are preview fixtures, not fallback production prices. Purchases are disabled in that preview. `/dev-paywall?state=plus` previews the active-plan screen.

The existing RevenueCat webhook and Space entitlement APIs remain authoritative. This pivot changes no backend quotas, billing integration, native dependencies, encryption, or service deployment. Store purchase and backend export checks still require configured services and a device build.
