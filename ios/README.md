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

## Pointing a build at your dev server

Release builds always talk to `https://tapworship.com`. A **Debug** build can
be pointed somewhere else, and the usual somewhere is your own `npm run dev`:

```sh
cd ios
./use-env dev     # reads ../env/dev.env → http://localhost:3000
./use-env prod    # back to tapworship.com
```

`use-env` copies exactly two values out of the env file, the two the app
needs and neither a secret: `NEXTAUTH_URL` (where the server is) and
`GOOGLE_IOS_CLIENT_ID`. It writes them to `Config/Local.xcconfig`
(gitignored), which `Config/Debug.xcconfig` includes, and re-runs `xcodegen`.
Database URLs and `NEXTAUTH_SECRET` never leave `env/`. Start the web app
(`npm run dev`), run the app in the **simulator**, and sign in with a dev
account; the sign-in screen and the Account tab both say "Development build"
so it's never mistaken for the real thing. A real phone can't reach your
Mac's `localhost`; give it the Mac's LAN address in `NEXTAUTH_URL` instead.

Plain http is accepted for localhost, `.local` names and private LAN
addresses only (`TapWorshipKit` `DevServer`, checked), which is all the
debug-only `NSAllowsLocalNetworking` in `Config/Info-Debug.plist` reaches.
Release builds carry no App Transport Security exception at all.

For a one-off (a Vercel preview, staging), set `TAPWORSHIP_API_URL` on the
Xcode scheme instead (Product → Scheme → Edit Scheme → Run → Environment
Variables). It wins over `use-env` and must be https.

## What the app has

| Screen | |
|---|---|
| Sign in | `SignInView` — the two fields, keyboard Next/Go, errors inline |
| My Sets | `MySetsView` — upcoming sets, "Needs your answer" first; swipe right to confirm; a set's page has Confirm · Request cover (with a note) · Cancel cover · Swap with someone. On top: **Swap requests** someone sent me (Accept / Decline) and **Cover needed** in a role I play (Take it, which asks first / Not me, with an optional note) |
| Swap picker | `SwapPickerSheet` — the sets I could trade a seat for, paged; each row carries the web's warnings (red: a seat someone already holds; amber: said they can't; grey: inactive), then a last look with a note before it sends |
| Calendar | `CalendarView` — a month grid with a dot per set in its status colour and a tint on days I'm on; the selected day's sets underneath; a set's page has the roster in the team's role order with open seats, the MD mark, guest teams, songs, practices and notes. Read-only: rosters are edited on the web |
| Availability | `AvailabilityView` — tap a day to block it all day, tap again to clear it (long-press for Block / Free); red = all day, amber ring = part of the day, ↻ = a weekly rule. Weekly blocks and part-day blocks list underneath with swipe-to-delete; **+** adds a weekly block or a one-day block. An open request from an admin sits on top with Review and submit (lists what's blocked in its window, takes a note) |
| Join | `JoinOrgView` — a new Apple/Google account enters its org key |
| Admin (admins) | `AdminView` — Approvals and Team as one tab, switched by a picker in the bar, so the app stays at five tabs. **Approvals**: covers and swaps waiting on an admin; swipe right to approve, left to reject (asks first); the tab carries a count badge. **Team**: searchable, sectioned by team; a person's page has Org admin, Musical director, and per team on/off, Scheduled automatically and roles. Every switch saves as it's flipped and springs back if refused |
| Account | `AccountView` — who's signed in, a link to /profile on the web, Sign out, Delete account |

The Admin tab shows only for someone who is an admin of some org; its two
halves share one org picker (top right, hidden with a single org) since they
send the `x-org-id` header the admin routes read. The web's **Create** tab
stays on the web on purpose: generating a schedule is a big-screen job, and
the web already refuses its review workspace at phone widths (`lib/layout.ts`
`PREVIEW_MIN_WIDTH`).

**Which clock.** Set times show in the phone's own zone, as a browser does.
Availability is different: the server stores a blocked day as midnight on the
app's clock (`APP_TZ`) and the scheduler judges it there, so the Availability
tab reads and writes days on `AppConfig.appCalendar` (America/Los_Angeles)
wherever the phone is. Every rule in `Availability` takes the calendar as an
argument, which is how the checks pin it.

The logic behind them lives in `TapWorshipKit` and is checked: `APIClient`
(every request is built by a pure `makeRequest`, every status read by a pure
`check`), `MobileSession`, `MySets` (grouping, which buttons a status
offers), `Admin`, `SetCalendar` (month cells, the roster and status rules
ported from `lib/setStatus.ts` / `lib/teamRoles.ts`), `Availability`
(`lib/availability.ts`: a day's level, what a tap does, requests owed),
`Swaps` (the picker's warnings and their order) and `DevServer`. 187 checks;
CI runs them on Linux in the `ios-kit` job.

**Not built yet:** push notifications (they need an APNs key from the Apple
Developer account and a server piece to send them) and Import from Google
Calendar, which stays on the web's /schedule.

**Not yet compiled:** the SwiftUI views in `App/` need Xcode, and nothing in
CI or the cloud sessions that wrote them has it. Each view has `#Preview`s
(light, dark, largest text, empty, offline) — open them on an SE and a Pro Max
before trusting them.

## Next

- Push notifications (APNs key, an entitlement, and a server sender).
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
