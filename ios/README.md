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

## Signing in

The app signs in with `POST /api/mobile/session` (username-or-email +
password), which answers a bearer token the app keeps in the Keychain and
sends as `Authorization: Bearer …` on every request. The token **is** the web
session's own NextAuth JWT, minted with `NEXTAUTH_SECRET` and the same claims
(`lib/mobileToken.ts`), and `getSessionUser` in `lib/auth.ts` reads a cookie
first and that header second — so every existing route serves the app with no
change, and a deleted account is signed out on both. It lasts 30 days, the
web session's own lifetime; signing out is the app forgetting it.

Who can't sign in here yet: accounts made with **Google** have no password.
The sign-in screen tells them to set one on the web. Offering Google on iOS
would also oblige Sign in with Apple (App Store rule 4.8).

## Pointing a build at staging

Release builds always talk to `https://tapworship.com`. A Debug build honours
`TAPWORSHIP_API_URL` from the Xcode scheme (Product → Scheme → Edit Scheme →
Run → Environment Variables), e.g. a Vercel preview URL. It must be https —
App Transport Security refuses plain http, and this app carries no exception.

## What the app has

| Screen | |
|---|---|
| Sign in | `SignInView` — the two fields, keyboard Next/Go, errors inline |
| My Sets | `MySetsView` — upcoming sets, "Needs your answer" first; swipe right to confirm; a set's page has Confirm · Request cover (with a note) · Cancel cover, the web's three buttons |
| Account | `AccountView` — who's signed in, a link to /profile on the web, Sign out |

The logic behind them lives in `TapWorshipKit` and is checked: `APIClient`
(every request is built by a pure `makeRequest`, every status read by a pure
`check`), `MobileSession`, and `MySets` (grouping, which buttons a status
offers, the web's status words). 61 checks; CI runs them on Linux in the
`ios-kit` job.

**Not yet compiled:** the SwiftUI views in `App/` need Xcode, and nothing in
CI or the cloud sessions that wrote them has it. Each view has `#Preview`s
(light, dark, largest text, empty, offline) — open them on an SE and a Pro Max
before trusting them.

## Next

- The calendar (`GET /api/sets`), then availability.
- **Account deletion inside the app** — App Store rule 5.1.1(v) requires it
  for any app with accounts, and the web has no self-serve delete yet either.
- A rate limit on sign-in. Neither door (the web form or this route) has one.
- The scheduling port (`lib/scheduler.ts` runs in the BROWSER today for staged
  auto-fill). Moving it server-side would serve both clients; decide before
  porting it.

## Before App Store Connect

`PRODUCT_BUNDLE_IDENTIFIER` in `project.yml` is a placeholder
(`com.tapworship.app`). Change it before registering the app — a bundle id is
the app's identity there and can't be reused once taken.

The app icon (`App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png`) is
generated from `assets/tw-logo-master.png` in the web project and has **no
alpha channel**, which Apple requires — the master is transparent around the
disc, so it's composited onto the disc's own `#121212` first.
