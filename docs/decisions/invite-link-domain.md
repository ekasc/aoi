---
status: blocked-on-domain
date: 2026-09-30
---

# Invite links: the universal link is not shippable yet

## What is done

A shared invite carries a code two ways. The custom scheme, `aoi://join?code=…`,
is registered in the built Info.plist and the Android intent filter, and comes
from `scheme` in `app.json`, so a rebuild carries it.

The JavaScript around it is complete and tested: `inviteAppLink` and
`inviteWebLink` build the two forms, `inviteMessage` words the message and spells
the code out in plain text as well, and `inviteCodeFromLink` reads a code back
out of a link, tolerating a upper-cased scheme, a spaced code, and a redirect
that flattened the query into the path. It ignores links that are not ours.

## What is blocked

`INVITE_UNIVERSAL_HOST` in `features/space/invite-code.ts` is `aoi.app`, which
is a placeholder. Nothing is known about whether that domain exists, resolves,
or is ours. There is no `apple-app-site-association` file, and no
`associatedDomains` in the app config.

So `https://aoi.app/join?code=…` in a shared message is a link to nothing.

## Why the message carries it anyway

The message also spells the code out, so a link that cannot open still leaves
the reader able to join. The custom scheme is the path that works, and the words
are the fallback behind it. That is why this is blocked rather than reverted.

## What unblocks it

1. Own the domain and point it at somewhere that serves
   `/.well-known/apple-app-site-association`, with the app's team ID and
   `com.ekasc.aoi`. Android needs the same file at
   `/.well-known/assetlinks.json`.
2. Put the domain in `ios.associatedDomains` in `app.json`.
3. Rebuild, so the entitlement is compiled in.
4. Tap a shared link between two real devices. That is the only test that
   proves the path, and nobody has run it.

## What has not been verified

Nobody has tapped a link on a second device. The tests prove the code agrees
with itself about a URL it constructed. They do not prove a message sent
between two phones opens the app.
