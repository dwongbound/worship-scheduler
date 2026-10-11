# TapWorship for iOS

A second client for the same backend, not a second app. The 70 routes under
`app/api/` in the web project are the API; nothing here re-implements them.

## Opening it

The Xcode project is generated, so there's one step before you can open
anything:

```sh
brew install xcodegen   # once
cd ios && xcodegen      # after any change to project.yml
open TapWorship.xcodeproj
```

`ios/project.yml` is the source of truth. `TapWorship.xcodeproj` is gitignored
— an `.xcodeproj` is a directory of machine-written state that conflicts on
every branch and whose diffs are unreadable, and regenerating it takes a
second.

## Layout

| | |
|---|---|
| `project.yml` | The Xcode project, as data |
| `App/` | The iOS app target: SwiftUI views, assets, entry point |
| `TapWorshipKit/` | Everything that isn't a view — API shapes, decoding, and (in time) the ported scheduling rules |

The split isn't ceremony. `TapWorshipKit` is a plain SwiftPM package with no
Apple-UI dependency, so it builds and runs its own suite **without Xcode**:

```sh
cd ios/TapWorshipKit && swift run Checks
```

That matters because the parts most likely to be wrong — the API shapes and
the scheduling rules that have to agree with the TypeScript — are exactly the
parts a simulator is slowest at checking.

## Why the suite is an executable, not XCTest

XCTest ships with Xcode, not the Command Line Tools, so `swift test` cannot
run on a machine without full Xcode. `Checks` is a plain executable that
asserts and exits non-zero, which runs anywhere `swift` does. `check()` is a
one-for-one stand-in for `XCTAssert`; these become real XCTest cases in Xcode
whenever that's worth doing.

It paid for itself immediately: the first version of `Coding.swift` used
Foundation's stock `.iso8601` date strategy, and **every date on every route**
failed to parse — the API emits milliseconds (`2026-10-11T17:00:00.000Z`) and
`.iso8601` rejects fractional seconds. That's a crash on a device you can't
hot-fix, caught before a line of UI existed.

## Where this is up to

Early. What's here is the foundation, verified; what isn't here is the app.

- **Done** — the API model shapes (`Models.swift`, mirroring `lib/types.ts`),
  the canonical JSON decoder, and 24 checks covering both the fat
  `GET /api/sets` payload and the thin single-set one.
- **Next, and blocking** — auth. 64 of the 70 routes read a NextAuth **cookie**
  session; a native client needs tokens. That endpoint belongs in the web app
  and should land before more Swift is written against a scheme that doesn't
  exist yet.
- **Then** — a real API client, sign-in, and the calendar. The scheduling port
  (`lib/scheduler.ts`, which runs in the BROWSER today for staged auto-fill)
  is the other big piece; moving it server-side instead would serve both
  clients and is worth deciding before porting it.

## Before App Store Connect

`PRODUCT_BUNDLE_IDENTIFIER` in `project.yml` is a placeholder
(`com.tapworship.app`). Change it before registering the app — a bundle id is
the app's identity there and can't be reused once taken.

The app icon (`App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png`) is
generated from `assets/tw-logo-master.png` in the web project and has **no
alpha channel**, which Apple requires — the master is transparent around the
disc, so it's composited onto the disc's own `#121212` first.
