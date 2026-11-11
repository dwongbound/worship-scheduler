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

**Sign in with Apple and Google** go through `POST /api/mobile/session/social`
with the provider's ID token, which the server verifies before believing
(`lib/socialToken.ts`). Either can create an account, which then lands on
`JoinOrgView` for an org key. Google runs without Google's SDK: the system web
sign-in sheet doing the authorization-code flow with PKCE (`GoogleSignIn.swift`,
rules in `TapWorshipKit` `GoogleOAuth`). Both offered side by side, Apple
first and the same size, is what App Store rule 4.8 asks for.

To switch them on: tick Sign in with Apple on the bundle id in the Apple
Developer portal and set `APPLE_BUNDLE_ID` on the server; create an **iOS**
OAuth client in Google Cloud, put its id in `App/AppConfig.swift`
(`googleIOSClientID`) and in `GOOGLE_IOS_CLIENT_ID` on the server. Until then
the Apple button answers "isn't set up yet" and the Google button is hidden.

**Deleting an account** (App Store rule 5.1.1(v)) is Account → Delete account:
a sheet that says it can't be undone, lists what goes, and arms only once
DELETE is typed. The web has the same on /profile; both call `DELETE /api/me`.

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
| Join | `JoinOrgView` — a new Apple/Google account enters its org key |
| Approvals (admins) | `ApprovalsView` — covers and swaps waiting on an admin; swipe right to approve, left to reject (asks first); a row's page has both as buttons. The tab carries a count badge |
| Team (admins) | `TeamView` — searchable, sectioned by team, people on no team last; a person's page has Org admin, Musical director, and per team: on/off, Scheduled automatically (the `active` flag), and their roles from that team's catalog. Every switch saves as it's flipped and springs back if refused. Remove from Org asks first. Your own admin switch and Remove are disabled |
| Account | `AccountView` — who's signed in, a link to /profile on the web, Sign out, Delete account |

The two admin tabs show only for someone who is an admin of some org, and
share one org picker (top right, hidden with a single org) since they send
the `x-org-id` header the admin routes read. The web's **Create** tab stays on
the web on purpose: generating a schedule is a big-screen job, and the web
already refuses its review workspace at phone widths (`lib/layout.ts`
`PREVIEW_MIN_WIDTH`).

The logic behind them lives in `TapWorshipKit` and is checked: `APIClient`
(every request is built by a pure `makeRequest`, every status read by a pure
`check`), `MobileSession`, `MySets` (grouping, which buttons a status
offers, the web's status words) and `Admin` (approval decoding, team search
and sections, the PATCH body carrying only what changed). 95 checks; CI runs them on Linux in the
`ios-kit` job.

**Not yet compiled:** the SwiftUI views in `App/` need Xcode, and nothing in
CI or the cloud sessions that wrote them has it. Each view has `#Preview`s
(light, dark, largest text, empty, offline) — open them on an SE and a Pro Max
before trusting them.

## Next

- The calendar (`GET /api/sets`), then availability.
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
