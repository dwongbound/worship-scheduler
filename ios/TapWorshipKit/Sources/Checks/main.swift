import Foundation
#if canImport(FoundationNetworking)
// Linux keeps URLSession/URLRequest in a separate module; on Apple platforms
// they're part of Foundation and this import doesn't exist.
import FoundationNetworking
#endif
import TapWorshipKit

// The suite, as an executable. See Package.swift for why this isn't XCTest.
// Exits non-zero on the first failure so `swift run Checks` is a real gate.

var failures = 0
var ran = 0

func check(_ what: String, _ condition: @autoclosure () -> Bool) {
  ran += 1
  if !condition() {
    failures += 1
    print("  ✗ \(what)")
  }
}

func section(_ name: String) { print("\n\(name)") }

// ── Decoding ────────────────────────────────────────────────────────────
// Fixtures are hand-written to match what the routes actually emit, INCLUDING
// the fields some endpoints omit: GET /api/sets sends `org` and `songs`, the
// single-set route doesn't, and a decoder that only ever saw the fat payload
// would crash on the thin one.
section("decoding ApiSet")

let fat = """
{
  "id": "set_1",
  "label": "Large Group",
  "startsAt": "2026-10-11T17:00:00.000Z",
  "durationMinutes": 90,
  "notes": null,
  "requiresMD": true,
  "isPrivate": false,
  "mdUserId": "u_2",
  "slotCapacities": { "VOCALS": 3, "KEYS": 1 },
  "groupChatLeadDays": 7,
  "teamId": "t_1",
  "team": { "id": "t_1", "name": "Sunday Team", "roles": [
    { "key": "WORSHIP_LEADER", "label": "Worship Leader", "defaultCount": 1, "adminOnly": false, "order": 0 }
  ] },
  "org": { "id": "o_1", "name": "Grace Chapel" },
  "assignments": [
    { "id": "a_1", "role": "KEYS", "status": "CONFIRMED",
      "user": { "id": "u_2", "name": "Priya Patel", "isMD": true } }
  ],
  "songs": [ { "id": "s_1", "title": "Who Else", "key": "E", "order": 0 } ],
  "spotifyPlaylistUrl": null
}
"""

let thin = """
{
  "id": "set_2", "label": null,
  "startsAt": "2026-10-14T19:00:00.000Z", "durationMinutes": 60,
  "notes": null, "requiresMD": false, "isPrivate": false,
  "mdUserId": null, "slotCapacities": null, "assignments": []
}
"""

let decoder = TapWorship.makeDecoder()

do {
  let set = try decoder.decode(ApiSet.self, from: Data(fat.utf8))
  check("label", set.label == "Large Group")
  check("startsAt parses as UTC", ISO8601DateFormatter().string(from: set.startsAt) == "2026-10-11T17:00:00Z")
  check("endsAt is start + duration", set.endsAt.timeIntervalSince(set.startsAt) == 90 * 60)
  check("capacities", set.slotCapacities?["VOCALS"] == 3)
  check("team catalog", set.team?.roles?.first?.label == "Worship Leader")
  check("assignment status", set.assignments.first?.status == .confirmed)
  check("isMD rides along", set.assignments.first?.user.isMD == true)
  check("song", set.songs?.first?.key == "E")
  // Absent ≠ present-and-null on the wire, but both mean "no value" here.
  check("guestTeamId absent decodes as nil", set.assignments.first?.guestTeamId == nil)
} catch {
  failures += 1
  print("  ✗ fat payload failed to decode: \(error)")
}

do {
  // The thin payload omits org/songs/team/teamId/groupChatLeadStatus entirely.
  let set = try decoder.decode(ApiSet.self, from: Data(thin.utf8))
  check("unlabelled set", set.label == nil)
  check("omitted org", set.org == nil)
  check("omitted songs", set.songs == nil)
  check("omitted team", set.team == nil)
  check("null capacities mean default shape", set.slotCapacities == nil)
  check("empty roster", set.assignments.isEmpty)
} catch {
  failures += 1
  print("  ✗ thin payload failed to decode: \(error)")
}

// Every status the server can send must round-trip; an unknown one is a crash
// waiting to happen on a phone that can't be hot-fixed.
section("AssignmentStatus covers the server enum")
for raw in ["PENDING", "CONFIRMED", "SWAP_REQUESTED", "PENDING_SWAP", "PENDING_APPROVAL"] {
  check("decodes \(raw)", AssignmentStatus(rawValue: raw) != nil)
}

// The bug this harness caught on its first run: the API sends milliseconds,
// and Foundation's stock .iso8601 strategy rejects them. Both spellings have
// to parse, and to the same instant.
section("ISO-8601 with and without milliseconds")
let withMs = TapWorship.parseISO8601("2026-10-11T17:00:00.000Z")
let noMs = TapWorship.parseISO8601("2026-10-11T17:00:00Z")
check("milliseconds parse", withMs != nil)
check("plain parses", noMs != nil)
check("same instant", withMs == noMs)
check("nonsense is rejected, not silently zero", TapWorship.parseISO8601("not a date") == nil)

// ── Sign-in ─────────────────────────────────────────────────────────────
// What POST /api/mobile/session answers (app/api/mobile/session/route.ts).
section("decoding MobileSession")
let sessionJSON = """
{ "token": "eyJ.abc.def", "expiresAt": "2026-12-11T02:00:00.000Z",
  "user": { "id": "u_1", "name": "Bob Baker", "email": null,
            "memberships": [ { "orgId": "o_1", "isAdmin": false } ] } }
"""
do {
  let s = try decoder.decode(MobileSession.self, from: Data(sessionJSON.utf8))
  check("token", s.token == "eyJ.abc.def")
  check("null email", s.user.email == nil)
  check("membership", s.user.memberships.first?.orgId == "o_1")
  check("not expired before expiresAt", !s.isExpired(now: s.expiresAt.addingTimeInterval(-1)))
  check("expired at expiresAt", s.isExpired(now: s.expiresAt))
  check("has an org", !s.user.hasNoOrg)
  // The Keychain stores it as JSON through our own encoder; it must come back.
  let again = try decoder.decode(MobileSession.self, from: TapWorship.makeEncoder().encode(s))
  check("round-trips through the app's encoder", again == s)
} catch {
  failures += 1
  print("  ✗ session failed to decode: \(error)")
}

// ── Requests ────────────────────────────────────────────────────────────
section("APIClient.makeRequest")
let base = URL(string: "https://tapworship.example")!
let signedIn = APIClient(baseURL: base, token: { "tok123" }, transport: { _ in fatalError("no network in Checks") })
let signedOut = APIClient(baseURL: base, token: { nil }, transport: { _ in fatalError("no network in Checks") })
do {
  let get = try signedIn.makeRequest("GET", "/api/assignments")
  check("absolute url", get.url?.absoluteString == "https://tapworship.example/api/assignments")
  check("bearer header", get.value(forHTTPHeaderField: "Authorization") == "Bearer tok123")
  check("GET has no body", get.httpBody == nil)
  let anonymous = try signedOut.makeRequest("GET", "/api/me")
  check("no token, no header", anonymous.value(forHTTPHeaderField: "Authorization") == nil)
  let login = try signedIn.makeRequest("POST", "/api/mobile/session", body: ["username": "bob"], authorized: false)
  check("sign-in never sends an old token", login.value(forHTTPHeaderField: "Authorization") == nil)
  check("json content type", login.value(forHTTPHeaderField: "Content-Type") == "application/json")
} catch {
  failures += 1
  print("  ✗ makeRequest threw: \(error)")
}

section("APIClient.check (status codes)")
func thrown(_ status: Int, _ body: String = "", authorized: Bool = true) -> APIError? {
  do { try APIClient.check(status: status, data: Data(body.utf8), authorized: authorized); return nil }
  catch { return error as? APIError }
}
check("200 passes", thrown(200) == nil)
check("204 passes", thrown(204) == nil)
check("401 signs out", thrown(401, #"{"error":"Unauthorized"}"#) == .unauthorized)
check("401 on sign-in keeps the server's words",
      thrown(401, #"{"error":"That username or password isn't right"}"#, authorized: false)
        == .server(status: 401, message: "That username or password isn't right"))
check("400 keeps the message", thrown(400, #"{"error":"Unknown action"}"#) == .server(status: 400, message: "Unknown action"))
check("500 without json", thrown(500, "<html>") == .server(status: 500, message: nil))
check("a server message is shown as-is", APIError.server(status: 400, message: "Nope").message == "Nope")
check("no message falls back to words", !APIError.server(status: 500, message: nil).message.isEmpty)

// ── My Sets ─────────────────────────────────────────────────────────────
// GET /api/assignments: the set row WITHOUT a roster, plus `pendingSwap`.
section("My Sets")
let mineJSON = """
[
  { "id": "a_1", "role": "KEYS", "status": "PENDING", "pendingSwap": null,
    "setId": "set_1", "userId": "u_1",
    "set": { "id": "set_1", "label": "Sunday", "startsAt": "2026-11-15T17:00:00.000Z",
             "durationMinutes": 90, "notes": null, "isPrivate": false,
             "org": { "id": "o_1", "name": "Grace Chapel" } } },
  { "id": "a_2", "role": "VOCALS", "status": "CONFIRMED", "pendingSwap": null,
    "set": { "id": "set_1", "label": "Sunday", "startsAt": "2026-11-15T17:00:00.000Z",
             "durationMinutes": 90, "notes": null, "isPrivate": false,
             "org": { "id": "o_1", "name": "Grace Chapel" } } },
  { "id": "a_3", "role": "SOUND_BOOTH", "status": "PENDING_SWAP",
    "pendingSwap": { "proposalId": "p_1", "isRequester": true },
    "set": { "id": "set_0", "label": null, "startsAt": "2026-11-12T03:00:00Z",
             "durationMinutes": 60, "notes": "Bring a capo" } }
]
"""
do {
  let mine = try decoder.decode([ApiMyAssignment].self, from: Data(mineJSON.utf8))
  check("three seats", mine.count == 3)
  check("pendingSwap", mine[2].pendingSwap?.isRequester == true)
  check("org absent is fine", mine[2].set.org == nil)
  let groups = MySets.grouped(mine)
  check("two sets, one per set", groups.count == 2)
  check("soonest first", groups.first?.set.id == "set_0")
  check("both roles on one set", groups.last?.seats.map(\.role) == ["KEYS", "VOCALS"])
  check("a pending seat flags its set", groups.last?.needsAttention == true)
  check("no pending seat, no flag", groups.first?.needsAttention == false)
} catch {
  failures += 1
  print("  ✗ my assignments failed to decode: \(error)")
}
check("pending: confirm + request cover", MySets.actions(for: .pending) == [.confirm, .requestSwap])
check("confirmed: request cover", MySets.actions(for: .confirmed) == [.requestSwap])
check("asking: cancel cover", MySets.actions(for: .swapRequested) == [.cancelSwap])
check("status words match the web", MySets.statusLabel(.pending) == "Pending confirmation")
check("built-in role label", RoleLabels.label(for: "VOCALS") == "Vox")
check("unknown role is humanized", RoleLabels.label(for: "SOUND_BOOTH") == "Sound Booth")
check("the team's own label wins", RoleLabels.label(for: "KEYS", in: [
  TeamRoleDef(key: "KEYS", label: "Piano", defaultCount: 1, adminOnly: false, order: 0),
]) == "Piano")
check("PATCH body uses the server's action names", AssignmentAction.requestSwap.rawValue == "requestSwap")

// ── Google, Apple, deletion ─────────────────────────────────────────────
section("Google OAuth (PKCE)")
let gid = "123-abc.apps.googleusercontent.com"
check("redirect scheme is the reversed client id", GoogleOAuth.redirectScheme(clientID: gid) == "com.googleusercontent.apps.123-abc")
check("redirect uri", GoogleOAuth.redirectURI(clientID: gid) == "com.googleusercontent.apps.123-abc:/oauthredirect")
let authURL = GoogleOAuth.authorizationURL(clientID: gid, codeChallenge: "chal", state: "st8")
let authItems = URLComponents(url: authURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
func item(_ n: String) -> String? { authItems.first { $0.name == n }?.value }
check("auth url host", authURL.host == "accounts.google.com")
check("S256 challenge", item("code_challenge_method") == "S256" && item("code_challenge") == "chal")
check("asks for openid + email", item("scope") == "openid email profile")
check("carries state", item("state") == "st8")
let cb = URL(string: "com.googleusercontent.apps.123-abc:/oauthredirect?state=st8&code=4/0Ab+x")!
check("reads the code", GoogleOAuth.readCallback(cb, expectedState: "st8") == .code("4/0Ab+x"))
check("wrong state is refused", GoogleOAuth.readCallback(cb, expectedState: "other") == .failed)
check("access_denied is a cancel", GoogleOAuth.readCallback(URL(string: "x:/r?error=access_denied")!, expectedState: "st8") == .cancelled)
let form = String(decoding: GoogleOAuth.tokenRequestBody(clientID: gid, code: "4/0Ab+x", codeVerifier: "v"), as: UTF8.self)
check("token body escapes +", form.contains("code=4/0Ab%2Bx"))
check("token body has the verifier, no secret", form.contains("code_verifier=v") && !form.contains("secret"))
check("base64url drops padding and swaps alphabet", GoogleOAuth.base64URL(Data([0xfb, 0xff])) == "-_8")

section("social sign-in + deletion")
check("409 with nameConflicts is its own error",
      thrown(409, #"{"error":"exists","nameConflicts":[{"name":"Sam R","email":"sam@x.com"}]}"#, authorized: false)
        == .nameConflicts([ExistingAccount(name: "Sam R", email: "sam@x.com")]))
check("a plain 409 stays a server error", thrown(409, #"{"error":"Only admin"}"#) == .server(status: 409, message: "Only admin"))
check("deletion phrase", AccountDeletion.matches(" DELETE ") && !AccountDeletion.matches("delete"))
do {
  let del = try signedIn.makeRequest("DELETE", "/api/me", body: ["confirm": AccountDeletion.phrase])
  check("delete sends the phrase", String(decoding: del.httpBody ?? Data(), as: UTF8.self).contains("DELETE"))
  check("delete is authorized", del.value(forHTTPHeaderField: "Authorization") == "Bearer tok123")
} catch {
  failures += 1
  print("  ✗ delete request threw: \(error)")
}

// ── Result ──────────────────────────────────────────────────────────────
print("\n\(ran - failures)/\(ran) checks passed")
if failures > 0 {
  print("\(failures) FAILED")
  exit(1)
}
print("OK")
