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

section("admin: approvals, team")
let approvalsJSON = """
[
  {"kind":"swap","id":"p1","role":"BASS","reason":"Away","createdAt":"2026-11-01T00:00:00.000Z",
   "requester":{"id":"u1","name":"Ana"},"recipient":{"id":"u2","name":"Ben"},
   "receive":{"id":"s1","label":null,"startsAt":"2026-11-22T17:00:00.000Z"},
   "giveUp":{"id":"s2","label":"Youth","startsAt":"2026-11-15T17:00:00.000Z"}},
  {"kind":"cover","id":"a9","role":"KEYS","reason":null,"createdAt":"2026-11-02T00:00:00.000Z",
   "taker":{"id":"u3","name":"Cy"},"originalOwner":null,
   "set":{"id":"s3","label":null,"startsAt":"2026-11-29T17:00:00.000Z"}}
]
"""
do {
  let items = try decoder.decode([ApiApproval].self, from: Data(approvalsJSON.utf8))
  check("decodes both kinds", items.map(\.kind) == ["swap", "cover"])
  check("swap's first date is the earlier set", ISO8601DateFormatter().string(from: items[0].firstDate) == "2026-11-15T17:00:00Z")
  check("swap summary", items[0].summary.hasPrefix("Ana and Ben are trading"))
  check("cover with no owner reads as someone", items[1].summary.hasPrefix("Cy is covering someone on"))
  check("approval id", items[1].id == "a9")
} catch {
  failures += 1
  print("  ✗ approvals threw: \(error)")
}
check("an unknown kind is refused",
      (try? decoder.decode([ApiApproval].self, from: Data(#"[{"kind":"trade","id":"x","role":"BASS"}]"#.utf8))) == nil)

let meJSON = #"{"name":"Dee","email":null,"hasPassword":true,"memberships":[{"orgId":"o2","orgName":"zion","isAdmin":true},{"orgId":"o1","orgName":"Grace","isAdmin":true},{"orgId":"o3","orgName":"Hope","isAdmin":false}]}"#
if let me = try? decoder.decode(ApiMe.self, from: Data(meJSON.utf8)) {
  check("adminOrgs drops non-admin orgs and sorts by name", me.adminOrgs.map(\.orgId) == ["o1", "o2"])
} else {
  failures += 1
  print("  ✗ ApiMe didn't decode")
}

let band = ApiOrgTeam(id: "t1", name: "Band", orgId: "o1", roles: [])
let youth = ApiOrgTeam(id: "t2", name: "Youth", orgId: "o1", roles: [])
let people = [
  ApiAdminUser(id: "u1", name: "José Ruiz", username: "jose", isMD: false, isAdmin: false,
               teams: [ApiMemberTeam(id: "t1", name: "Band", roles: ["BASS"], active: false)]),
  ApiAdminUser(id: "u2", name: "Kim", username: "kimk", isMD: true, isAdmin: true,
               teams: [ApiMemberTeam(id: "t1", name: "Band", roles: ["KEYS"], active: true),
                       ApiMemberTeam(id: "t2", name: "Youth", roles: [], active: true)]),
  ApiAdminUser(id: "u3", name: "Lee", username: "lee", isMD: false, isAdmin: false, teams: []),
]
check("search ignores accents and case", TeamList.filter(people, query: " jose ").map(\.id) == ["u1"])
check("search matches username", TeamList.filter(people, query: "KIMK").map(\.id) == ["u2"])
check("blank search is everyone", TeamList.filter(people, query: "  ").count == 3)
let sections = TeamList.byTeam(people, teams: [band, youth])
check("sections by team, teamless last", sections.map(\.title) == ["Band", "Youth", "On no team"])
check("someone on two teams shows in both", sections[0].members.count == 2 && sections[1].members.map(\.id) == ["u2"])
check("empty teams are dropped", TeamList.byTeam([people[2]], teams: [band]).map(\.title) == ["On no team"])
check("inactive everywhere", people[0].isInactiveEverywhere && !people[1].isInactiveEverywhere && !people[2].isInactiveEverywhere)

do {
  let patch = MemberPatch(teamActive: [.init(teamId: "t1", active: false)])
  let req = try signedIn.makeRequest("PATCH", "/api/admin/users/u1", body: patch, orgId: "o1")
  let body = String(decoding: req.httpBody ?? Data(), as: UTF8.self)
  check("patch sends only what changed", body.contains("teamActive") && !body.contains("isAdmin") && !body.contains("teamIds"))
  check("admin calls name their org", req.value(forHTTPHeaderField: "x-org-id") == "o1")
  let plain = try signedIn.makeRequest("GET", "/api/assignments")
  check("other calls carry no org header", plain.value(forHTTPHeaderField: "x-org-id") == nil)
} catch {
  failures += 1
  print("  ✗ admin request threw: \(error)")
}

// ── Calendar ────────────────────────────────────────────────────────────
section("calendar: days, roster, status")

var la = Calendar(identifier: .gregorian)
la.timeZone = TimeZone(identifier: "America/Los_Angeles")!
la.firstWeekday = 1
var tokyo = Calendar(identifier: .gregorian)
tokyo.timeZone = TimeZone(identifier: "Asia/Tokyo")!

func at(_ iso: String) -> Date { TapWorship.parseISO8601(iso)! }

// 6:30 PM Saturday in LA is already Sunday in Tokyo: the day a set sits on
// is the calendar's, never UTC's.
let lateSaturday = at("2026-11-08T02:30:00.000Z")
check("ymd reads the calendar's zone", SetCalendar.ymd(lateSaturday, calendar: la) == "2026-11-07")
check("the same instant is the next day in Tokyo", SetCalendar.ymd(lateSaturday, calendar: tokyo) == "2026-11-08")
check("ymd round-trips through date(ymd:)", SetCalendar.ymd(SetCalendar.date(ymd: "2026-03-08", calendar: la)!, calendar: la) == "2026-03-08")
check("a malformed day is nil", SetCalendar.date(ymd: "2026-03", calendar: la) == nil)

let november = SetCalendar.date(ymd: "2026-11-17", calendar: la)!
let cells = SetCalendar.monthCells(november, calendar: la)
check("November 2026 starts on a Sunday: no leading blanks", cells.first.flatMap { $0 }.map { SetCalendar.ymd($0, calendar: la) } == "2026-11-01")
check("grid is whole weeks", cells.count == 35 && cells.compactMap { $0 }.count == 30)
let october = SetCalendar.monthCells(SetCalendar.date(ymd: "2026-10-05", calendar: la)!, calendar: la)
check("October 2026 leads with four blanks (starts Thursday)", october.prefix(4).allSatisfy { $0 == nil } && october[4] != nil)
// The fall-back night has 25 hours; a day stepped by 86,400s would repeat.
check("a DST month has every day once", Set(cells.compactMap { $0 }.map { SetCalendar.ymd($0, calendar: la) }).count == 30)
check("sets path", SetCalendar.path(from: cells[0]!, to: cells[29]!, orgId: "o1", calendar: la) == "/api/sets?from=2026-11-01&to=2026-11-30&orgId=o1")

func makeSet(_ json: String) -> ApiSet { try! decoder.decode(ApiSet.self, from: Data(json.utf8)) }

let rosterSet = makeSet("""
{ "id": "s9", "label": "Sunday", "startsAt": "2026-11-08T18:00:00.000Z", "durationMinutes": 90,
  "notes": null, "requiresMD": true, "isPrivate": false, "mdUserId": "u2",
  "slotCapacities": { "VOCALS": 2, "KEYS": 1, "DRUMS": 1, "ACOUSTIC_GUITAR": 1 },
  "teamId": "t1",
  "team": { "id": "t1", "name": "Band", "roles": [
    { "key": "VOCALS", "label": "Singers", "defaultCount": 3, "adminOnly": false, "order": 1 },
    { "key": "KEYS", "label": "Keys", "defaultCount": 1, "adminOnly": false, "order": 0 },
    { "key": "DRUMS", "label": "Drums", "defaultCount": 1, "adminOnly": false, "order": 2 },
    { "key": "ACOUSTIC_GUITAR", "label": "Acoustic", "defaultCount": 1, "adminOnly": false, "order": 3 },
    { "key": "MD", "label": "MD", "defaultCount": 1, "adminOnly": true, "order": 4 }
  ] },
  "assignments": [
    { "id": "a1", "role": "KEYS", "status": "CONFIRMED", "user": { "id": "u2", "name": "Priya" } },
    { "id": "a2", "role": "VOCALS", "status": "PENDING", "user": { "id": "u3", "name": "Sam" } },
    { "id": "a3", "role": "CHOIR", "status": "CONFIRMED", "guestTeamId": "g1", "user": { "id": "u4", "name": "Ana" } },
    { "id": "a4", "role": "TRIANGLE", "status": "CONFIRMED", "user": { "id": "u5", "name": "Lee" } }
  ],
  "guestTeams": [ { "id": "g1", "teamId": "t2",
    "roles": [ { "role": "CHOIR", "allAvailable": true }, { "role": "STRINGS", "count": 2 } ],
    "team": { "id": "t2", "name": "Choir" } } ],
  "practices": [ { "id": "p1", "startsAt": "2026-11-05T03:00:00.000Z", "endsAt": "2026-11-05T04:30:00.000Z" } ]
}
""")
let rows = SetCalendar.roster(rosterSet)
check("roster follows the catalog's order, MD is not a seat", rows.prefix(4).map(\.id) == ["KEYS", "VOCALS", "DRUMS", "ACOUSTIC_GUITAR"])
check("a role wears the team's label", rows[1].label == "Singers")
check("the set's own shape beats the team default", rows[1].open == 1)
check("an empty role still shows its open seat", rows[2].people.isEmpty && rows[2].open == 1)
check("guest roles follow, named for their team", rows[4].guestTeam == "Choir" && rows[4].people.map(\.user.name) == ["Ana"])
check("an unbounded guest seat is never short", rows[4].open == 0)
check("a counted guest seat is", rows[5].id == "g1:STRINGS" && rows[5].open == 2)
check("nobody is dropped: a deleted role's seat still shows", rows.last?.label == "Triangle" && rows.last?.people.count == 1)
check("empty acoustic is never a hole", SetCalendar.openSlots(rosterSet) == 4)
check("open seats make a set understaffed", SetCalendar.status(rosterSet) == .understaffed)
check("practices decode", rosterSet.practices?.first?.endsAt == at("2026-11-05T04:30:00.000Z"))
check("the MD is marked by id", SetCalendar.isMD(rosterSet.assignments[0], on: rosterSet) && !SetCalendar.isMD(rosterSet.assignments[1], on: rosterSet))
check("my seats on a set", SetCalendar.seats(of: "u3", on: rosterSet).map(\.id) == ["a2"] && SetCalendar.seats(of: nil, on: rosterSet).isEmpty)

func fullSet(_ statuses: [String]) -> ApiSet {
  let seats = statuses.enumerated().map { i, s in
    #"{ "id": "a\#(i)", "role": "KEYS", "status": "\#(s)", "user": { "id": "u\#(i)", "name": "P\#(i)" } }"#
  }.joined(separator: ",")
  return makeSet("""
  { "id": "s", "label": null, "startsAt": "2026-11-08T18:00:00.000Z", "durationMinutes": 60, "notes": null,
    "requiresMD": false, "isPrivate": false, "mdUserId": null, "slotCapacities": { "KEYS": \(statuses.count) },
    "team": { "id": "t", "name": "T", "roles": [ { "key": "KEYS", "label": "Keys", "defaultCount": 1, "adminOnly": false, "order": 0 } ] },
    "assignments": [\(seats)] }
  """)
}
check("everyone confirmed", SetCalendar.status(fullSet(["CONFIRMED", "CONFIRMED"])) == .confirmed)
check("one pending", SetCalendar.status(fullSet(["CONFIRMED", "PENDING"])) == .unconfirmed)
check("waiting on an admin is unconfirmed too", SetCalendar.status(fullSet(["PENDING_APPROVAL"])) == .unconfirmed)
check("a cover request outranks everything", SetCalendar.status(fullSet(["SWAP_REQUESTED", "PENDING"])) == .cover)
check("an empty set needs people", SetCalendar.status(fullSet([])) == .understaffed)
check("a set with no team falls back to the built-in shape", SetCalendar.roster(makeSet(thin)).map(\.id).first == "WORSHIP_LEADER")
let grouped = SetCalendar.byDay([rosterSet, fullSet(["CONFIRMED"])], calendar: la)
check("sets group under their local day", grouped["2026-11-08"]?.count == 2 && grouped.count == 1)

// ── Availability ────────────────────────────────────────────────────────
section("availability")

// The server stores a day as ITS midnight: Nov 10 in LA is 08:00Z.
func laDay(_ ymd: String) -> Date { SetCalendar.date(ymd: ymd, calendar: la)! }
let everyTuesday = ApiUnavailability(id: "r1", type: .recurring, dayOfWeek: 2, startMinute: 0, endMinute: 1440)
let tuesdayEvenings = ApiUnavailability(id: "r2", type: .recurring, dayOfWeek: 2, startMinute: 18 * 60, endMinute: 21 * 60,
                                        startDate: laDay("2026-11-01"), endDate: laDay("2026-11-30"), exceptDates: ["2026-11-17"])
let trip = ApiUnavailability(id: "d1", type: .specific, startMinute: 0, endMinute: 1440, startDate: laDay("2026-11-12"), endDate: laDay("2026-11-14"))
let morning = ApiUnavailability(id: "d2", type: .specific, startMinute: 9 * 60, endMinute: 12 * 60, startDate: laDay("2026-11-20"))
let legacy = ApiUnavailability(id: "d3", type: .dateRange, startDate: laDay("2026-12-24"), endDate: laDay("2026-12-26"))

check("an all-day weekly rule blocks its weekday", Availability.level([everyTuesday], on: "2026-11-10", calendar: la) == .full)
check("and no other day", Availability.level([everyTuesday], on: "2026-11-11", calendar: la) == nil)
check("a timed rule is partial", Availability.level([tuesdayEvenings], on: "2026-11-10", calendar: la) == .partial)
check("a freed date is a hole in the rule", Availability.level([tuesdayEvenings], on: "2026-11-17", calendar: la) == nil)
check("a rule stops at its last day", Availability.level([tuesdayEvenings], on: "2026-12-01", calendar: la) == nil)
check("and doesn't start early", Availability.level([tuesdayEvenings], on: "2026-10-27", calendar: la) == nil)
check("full wins over partial", Availability.level([tuesdayEvenings, everyTuesday], on: "2026-11-10", calendar: la) == .full)
check("a range covers its last day", Availability.level([trip], on: "2026-11-14", calendar: la) == .full)
check("but not the day after", Availability.level([trip], on: "2026-11-15", calendar: la) == nil)
check("a morning block is partial", Availability.level([morning], on: "2026-11-20", calendar: la) == .partial)
check("a legacy range is always all day", Availability.level([legacy], on: "2026-12-25", calendar: la) == .full)
// The phone's own zone must not move a day: read in Tokyo, LA's midnight is
// late afternoon, so a range would slide.
check("days are judged on the app's clock, not the phone's", Availability.level([trip], on: "2026-11-11", calendar: la) == nil)
check("repeat marker", Availability.isRepeating([everyTuesday, trip], on: "2026-11-10", calendar: la) && !Availability.isRepeating([everyTuesday, trip], on: "2026-11-12", calendar: la))

let allDay = Availability.allDayBlockedDays([everyTuesday, trip, morning, legacy], calendar: la)
check("only dated all-day blocks are tap-to-clear", allDay == ["2026-11-12", "2026-11-13", "2026-11-14", "2026-12-24", "2026-12-25", "2026-12-26"])
check("a tap blocks a free day", Availability.tapBlocks([trip], on: "2026-11-20", calendar: la))
check("a tap blocks over a weekly repeat", Availability.tapBlocks([everyTuesday], on: "2026-11-10", calendar: la))
check("a tap clears a day blocked by hand", !Availability.tapBlocks([trip], on: "2026-11-13", calendar: la))
let painted = Availability.applyingTap([morning], on: "2026-11-20", block: true, calendar: la)
check("optimistic block reads full at once", Availability.level(painted, on: "2026-11-20", calendar: la) == .full)
let freed = Availability.applyingTap([everyTuesday, morning], on: "2026-11-10", block: false, calendar: la)
check("optimistic free punches the weekly rule", Availability.level(freed, on: "2026-11-10", calendar: la) == nil && Availability.level(freed, on: "2026-11-17", calendar: la) == .full)
check("and leaves other days alone", Availability.level(freed, on: "2026-11-20", calendar: la) == .partial)
check("blocks on a day", Availability.blocks(on: "2026-11-10", in: [everyTuesday, tuesdayEvenings, trip], calendar: la).map(\.id) == ["r1", "r2"])

let older = ApiAvailabilityRequest(id: "q1", startDate: laDay("2026-10-01"), endDate: laDay("2026-10-31"), orgId: "o1", createdAt: at("2026-09-01T00:00:00Z"))
let newer = ApiAvailabilityRequest(id: "q2", name: "Advent", startDate: laDay("2026-11-10"), endDate: laDay("2026-11-20"), orgId: "o1", createdAt: at("2026-11-01T00:00:00Z"))
let otherOrg = ApiAvailabilityRequest(id: "q3", startDate: laDay("2026-11-01"), endDate: laDay("2026-11-30"), orgId: "o2", createdAt: at("2026-10-15T00:00:00Z"))
check("each org's newest request is the active one", Availability.activeRequests([older, otherOrg, newer]).map(\.id) == ["q2", "q3"])
let answers = [ApiAvailabilityResponse(requestId: "q2", completedAt: at("2026-11-02T00:00:00Z")), ApiAvailabilityResponse(requestId: "q3", completedAt: nil, note: "kept")]
let mine = ApiAvailability(entries: [], requests: [older, newer, otherOrg], responses: answers)
check("an un-submitted row still owes", Availability.owed(mine).map(\.id) == ["q3"])
check("an old request is never owed", !Availability.owed(mine).contains { $0.id == "q1" })
let inWindow = Availability.blockedDays([everyTuesday, trip, morning], from: newer.startDate, to: newer.endDate, calendar: la)
check("blocked days inside a request's window", inWindow.map(\.ymd) == ["2026-11-10", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-17", "2026-11-20"])
check("with their levels", inWindow.last?.level == .partial && inWindow.first?.level == .full)

check("a range lists every day", Availability.ymds(from: laDay("2026-11-29"), through: laDay("2026-12-02"), calendar: la) == ["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"])
check("a backwards range is empty", Availability.ymds(from: laDay("2026-12-02"), through: laDay("2026-11-29"), calendar: la).isEmpty)
check("range problems", Availability.rangeProblem(from: laDay("2026-12-02"), through: laDay("2026-11-29"), startMinute: 0, endMinute: 1440, calendar: la) != nil
      && Availability.rangeProblem(from: laDay("2026-01-01"), through: laDay("2026-06-01"), startMinute: 0, endMinute: 1440, calendar: la) != nil
      && Availability.rangeProblem(from: laDay("2026-11-29"), through: laDay("2026-11-29"), startMinute: 0, endMinute: 1440, calendar: la) == nil)
let runs = Availability.runs(inWindow, calendar: la)
check("back-to-back days fold into runs", runs.map(\.days) == [1, 3, 1, 1] && runs[1].level == .full)
check("a different level starts a new run", Availability.runs(inWindow, calendar: la).last?.level == .partial)
check("day details put all-day first", Availability.dayDetails([tuesdayEvenings, everyTuesday], on: "2026-11-10", calendar: la).map(\.id) == ["r1", "r2"])
check("times read like the web's", Availability.timeLabel(18 * 60) == "6 PM" && Availability.timeLabel(9 * 60 + 30) == "9:30 AM" && Availability.timeLabel(0) == "12 AM" && Availability.timeLabel(12 * 60) == "12 PM")
check("window words", Availability.windowLabel(everyTuesday) == "All day" && Availability.windowLabel(tuesdayEvenings) == "6 PM – 9 PM")
check("weekly rules sort by day then time", Availability.weeklyRules([tuesdayEvenings, trip, everyTuesday]).map(\.id) == ["r1", "r2"])
check("weekly title", Availability.weeklyTitle(everyTuesday) == "Every Tuesday")
check("timed blocks list only part-day, upcoming ones", Availability.timedBlocks([trip, morning, everyTuesday], now: laDay("2026-11-18"), calendar: la).map(\.id) == ["d2"]
      && Availability.timedBlocks([morning], now: laDay("2026-11-21"), calendar: la).isEmpty)
check("a weekly block needs a day", Availability.weeklyProblem(days: [], startMinute: 0, endMinute: 1440) != nil)
check("and an end after its start", Availability.weeklyProblem(days: [2], startMinute: 600, endMinute: 600) != nil && Availability.weeklyProblem(days: [2], startMinute: 0, endMinute: 1440) == nil)

do {
  let wire = """
  { "entries": [
      { "id": "e1", "userId": "u1", "type": "RECURRING", "dayOfWeek": 2, "startMinute": 1080, "endMinute": 1260,
        "startDate": null, "endDate": "2026-12-01T08:00:00.000Z", "exceptDates": ["2026-11-17"],
        "requestId": null, "fromGoogle": false, "note": null, "createdAt": "2026-10-01T00:00:00.000Z" },
      { "id": "e2", "type": "SPECIFIC", "dayOfWeek": null, "startMinute": 0, "endMinute": 1440,
        "startDate": "2026-11-12T08:00:00.000Z", "endDate": null, "exceptDates": [], "requestId": "q2", "fromGoogle": true, "note": null } ],
    "requests": [ { "id": "q2", "name": null, "startDate": "2026-11-10T08:00:00.000Z", "endDate": "2026-11-20T08:00:00.000Z",
                    "orgId": "o1", "createdAt": "2026-11-01T00:00:00.000Z", "org": { "id": "o1", "name": "Grace Chapel" } } ],
    "responses": [ { "requestId": "q2", "completedAt": null, "edited": false, "note": null } ],
    "googleImport": true }
  """
  let got = try decoder.decode(ApiAvailability.self, from: Data(wire.utf8))
  check("availability decodes", got.entries.count == 2 && got.requests.first?.org?.name == "Grace Chapel")
  check("the server's midnight is the right LA day", Availability.level(got.entries, on: "2026-11-12", calendar: la) == .full)
  check("a rule's last day counts", Availability.level(got.entries, on: "2026-12-01", calendar: la) == .partial)

  let paint = try signedIn.makeRequest("POST", "/api/availability/block-days", body: ["start": "2026-11-12", "end": "2026-11-12"])
  check("writes carry the bearer", paint.value(forHTTPHeaderField: "Authorization") == "Bearer tok123")
  let weekly = try TapWorship.makeEncoder().encode([WeeklyBlockInput(dayOfWeek: 2, startMinute: 0, endMinute: 1440)])
  let weeklyText = String(decoding: weekly, as: UTF8.self)
  check("an open-ended weekly block sends no dates", !weeklyText.contains("startDate") && !weeklyText.contains("endDate"))
} catch {
  failures += 1
  print("  ✗ availability threw: \(error)")
}

// ── Swaps ───────────────────────────────────────────────────────────────
section("covers and swaps")

do {
  let coversWire = """
  [ { "id": "a7", "role": "BASS", "status": "SWAP_REQUESTED", "reason": "Out of town", "swapReason": "Out of town",
      "userId": "u9", "setId": "s3",
      "set": { "id": "s3", "label": "Sunday", "startsAt": "2026-11-22T18:00:00.000Z", "durationMinutes": 90,
               "notes": null, "isPrivate": false, "teamId": "t1", "org": { "id": "o1", "name": "Grace Chapel" } },
      "user": { "id": "u9", "name": "Marcus Bell" } } ]
  """
  let covers = try decoder.decode([ApiOpenCover].self, from: Data(coversWire.utf8))
  check("open cover decodes", covers.first?.user.name == "Marcus Bell" && covers.first?.reason == "Out of town" && covers.first?.set.org?.name == "Grace Chapel")

  let incomingWire = """
  [ { "id": "p1", "role": "KEYS", "requestedBy": { "id": "u2", "name": "Priya" }, "reason": null,
      "giveUp": { "id": "s1", "label": "Sunday", "startsAt": "2026-11-22T18:00:00.000Z", "org": { "id": "o1", "name": "Grace" } },
      "receive": { "id": "s2", "label": null, "startsAt": "2026-11-29T18:00:00.000Z", "org": { "id": "o1", "name": "Grace" } } } ]
  """
  let incoming = try decoder.decode([ApiSwapProposal].self, from: Data(incomingWire.utf8))
  check("incoming swap decodes", incoming.first?.requestedBy.name == "Priya" && incoming.first?.receive.label == nil)
  check("waiting count", Swaps.waitingCount(covers: covers, proposals: incoming) == 2)

  let pageWire = """
  { "items": [ { "toAssignmentId": "b1", "role": "KEYS", "status": "CONFIRMED",
      "counterparty": { "id": "u2", "name": "Priya" },
      "set": { "id": "s2", "label": "Sunday", "startsAt": "2026-11-29T18:00:00.000Z", "durationMinutes": 90, "team": { "id": "t1", "name": "Band" } },
      "youAvailable": true, "theyAvailable": false, "theyInactive": false,
      "theyAlsoOnYourSet": [], "youAlsoOnTheirSet": ["VOCALS"] } ], "hasMore": true }
  """
  let page = try decoder.decode(SwapCandidatePage.self, from: Data(pageWire.utf8))
  let warned = Swaps.warnings(for: page.items[0])
  check("candidates decode", page.hasMore && page.items.count == 1)
  check("a seat already held is the red warning, and comes first", warned.first?.severity == .fact && warned.first?.text == "You're already on that set (Vox)")
  check("availability is the amber one", warned.last?.severity == .intention && warned.count == 2)
} catch {
  failures += 1
  print("  ✗ swaps threw: \(error)")
}

func candidate(_ id: String, _ iso: String, youFree: Bool = true, double: [RoleKey] = [], inactive: Bool = false) -> ApiSwapCandidate {
  ApiSwapCandidate(toAssignmentId: id, role: "KEYS", counterparty: ApiUserRef(id: "u", name: "Kim"),
                   set: SwapCandidateSet(id: "s\(id)", startsAt: at(iso), durationMinutes: 60),
                   youAvailable: youFree, theyInactive: inactive, theyAlsoOnYourSet: double)
}
let pool = [
  candidate("double", "2026-11-01T18:00:00Z", double: ["BASS"]),
  candidate("busy", "2026-11-02T18:00:00Z", youFree: false),
  candidate("late", "2026-11-20T18:00:00Z"),
  candidate("soon", "2026-11-05T18:00:00Z", inactive: true),
]
check("clean trades first, then amber, then red", Swaps.ranked(pool).map(\.id) == ["soon", "late", "busy", "double"])
check("a clean trade has no warnings", Swaps.warnings(for: pool[2]).isEmpty)
check("inactive is a note, not a warning colour", Swaps.warnings(for: pool[3]).map(\.severity) == [.note])
check("their double shift names them", Swaps.warnings(for: pool[0]).first?.text == "Kim is already on your set (Bass)")
check("a seat mid-handoff offers no buttons", MySets.actions(for: .pendingSwap).isEmpty && MySets.actions(for: .pendingApproval).isEmpty)
check("only a settled seat can be traded", MySets.canProposeSwap(.confirmed) && MySets.canProposeSwap(.pending) && !MySets.canProposeSwap(.swapRequested) && !MySets.canProposeSwap(.pendingSwap))
check("candidates path", Swaps.candidatesPath(assignmentId: "a1", skip: 20) == "/api/swaps/candidates?assignmentId=a1&skip=20&take=20")
check("a blank note is no note", Swaps.cleanNote("  \n ") == nil && Swaps.cleanNote(" hi ") == "hi")
check("a note is capped like the server's", Swaps.cleanNote(String(repeating: "x", count: 600))?.count == 500)

// ── Dev server ──────────────────────────────────────────────────────────
section("debug builds: which servers")

check("the local dev server", DevServer.url("http://localhost:3000")?.absoluteString == "http://localhost:3000")
check("this Mac by address, and a LAN address", DevServer.url("http://127.0.0.1:3000") != nil && DevServer.url("http://192.168.68.94:3000") != nil)
check("a .local name", DevServer.url("http://macbook.local:3000") != nil)
check("https anywhere", DevServer.url(" https://staging.example.com ")?.host == "staging.example.com")
check("never plain http to the internet", DevServer.url("http://tapworship.com") == nil && DevServer.url("http://8.8.8.8") == nil)
check("172.16–31 is private, 172.32 is not", DevServer.url("http://172.20.1.1") != nil && DevServer.url("http://172.32.1.1") == nil)
check("blank or unset stays on production", DevServer.url("") == nil && DevServer.url(nil) == nil && DevServer.url("   ") == nil)
check("not a URL", DevServer.url("localhost:3000") == nil && DevServer.url("ftp://localhost") == nil)
check("client id", DevServer.clientID(" 123-abc.apps.googleusercontent.com ") == "123-abc.apps.googleusercontent.com")
check("an unfilled build setting is no client id", DevServer.clientID("$(GOOGLE_IOS_CLIENT_ID)") == nil && DevServer.clientID("") == nil)

section("set page extras")
do {
  let api = APIClient(baseURL: URL(string: "https://tapworship.com")!, token: { "t" })
  let note = try api.makeRequest("PATCH", "/api/sets/s1", body: ["notes": "Bring cables"])
  check("a note is a PATCH of the set's notes", note.httpMethod == "PATCH" && note.url?.path == "/api/sets/s1"
    && String(data: note.httpBody ?? Data(), encoding: .utf8)?.contains("Bring cables") == true)
  check("blank note isn't sent", SetNotes.ready("  \n ") == nil && SetNotes.ready(" hi ") == "hi")
  let setJSON = #"{"id":"s1","label":null,"startsAt":"2026-11-01T17:00:00.000Z","durationMinutes":90,"notes":null,"requiresMD":false,"isPrivate":false,"mdUserId":null,"slotCapacities":null,"groupChatLeadDays":null,"teamId":null,"team":null,"org":null,"assignments":[{"id":"a1","role":"WORSHIP_LEADER","status":"PENDING","user":{"id":"u1","name":"Paul"},"guestTeamId":null,"pendingFromUser":null}],"songs":[],"spotifyPlaylistUrl":null,"practices":[],"guestTeams":[]}"#
  let set = try TapWorship.makeDecoder().decode(ApiSet.self, from: Data(setJSON.utf8))
  check("the worship leader may post", SetNotes.canPost(on: set, userId: "u1", isOrgAdmin: false))
  check("someone else may not, an admin may", !SetNotes.canPost(on: set, userId: "u2", isOrgAdmin: false) && SetNotes.canPost(on: set, userId: "u2", isOrgAdmin: true))
  let avail = try TapWorship.makeDecoder().decode(PracticeAvailability.self, from: Data(#"{"people":[{"userId":"b","name":"Zed","roles":["BASS"],"free":true,"blockedBy":[]},{"userId":"a","name":"Amy","roles":["KEYS"],"free":false,"blockedBy":[{"type":"RECURRING"}]},{"userId":"c","name":"Bo","roles":[],"free":true,"blockedBy":[]}]}"#.utf8))
  check("practice: free first, then by name", avail.sorted.map(\.name) == ["Bo", "Zed", "Amy"])
  let log = try TapWorship.makeDecoder().decode([ApiSetHistoryEvent].self, from: Data(#"[{"id":"h1","type":"NOTES_CHANGED","role":null,"detail":"added a note","createdAt":"2026-11-02T10:00:00.000Z","actor":{"id":"u1","name":"Paul"},"targetUser":null,"previousUser":null}]"#.utf8))
  check("note text from a log line", SetNotes.text(fromDetail: #"added a note: "Bring "the" cables""#) == #"Bring "the" cables"#
    && SetNotes.text(fromDetail: "cleared the notes") == "cleared the notes")
  check("note log decodes", log.first?.actor?.name == "Paul" && log.first?.detail == "added a note")
} catch {
  failures += 1
  print("  ✗ set page extras threw: \(error)")
}

section("profile")
do {
  let meJSON = #"{"username":"bob","name":"Bob Baker","email":"bob@example.com","dailyDigest":true,"calendarInvites":true,"calendarInviteEmails":false,"calendarInviteEmail":null,"hasPassword":true,"memberships":[{"orgId":"o1","orgName":"Sunday Church","isAdmin":false,"slackUserId":null,"orgSlackConnected":false}],"teams":[{"id":"t1","name":"Sunday Team","orgId":"o1","roles":["DRUMS","WORSHIP_LEADER","GONE"],"catalog":[{"key":"WORSHIP_LEADER","label":"Worship Leader","defaultCount":1,"adminOnly":false,"order":0},{"key":"DRUMS","label":"Drums","defaultCount":1,"adminOnly":false,"order":3}],"active":false}]}"#
  let me = try TapWorship.makeDecoder().decode(ApiProfile.self, from: Data(meJSON.utf8))
  check("/api/me decodes", me.name == "Bob Baker" && me.hasPassword && me.teams.first?.active == false)
  check("my roles in the team's order, a deleted one still named", me.teams[0].roleLabels.prefix(2) == ["Worship Leader", "Drums"] && me.teams[0].roleLabels.count == 3)
  check("invites go to the email unless overridden", me.inviteAddress == "bob@example.com")
  check("team's org by name", me.orgName(for: me.teams[0]) == "Sunday Church")
  var update = ProfileUpdate(keeping: me)
  update.dailyDigest = false
  let body = String(data: try TapWorship.makeEncoder().encode(update), encoding: .utf8) ?? ""
  check("a switch save keeps name and email, sends only that switch",
        body.contains("\"name\":\"Bob Baker\"") && body.contains("bob@example.com") && body.contains("\"dailyDigest\":false") && !body.contains("calendarInvites") && !body.contains("password"))
  var noEmail = update; noEmail.email = nil
  let nullBody = String(data: try TapWorship.makeEncoder().encode(noEmail), encoding: .utf8) ?? ""
  check("no email is sent as null, not left out", nullBody.contains("\"email\":null"))
  check("password rules", ProfileRules.passwordProblem("short", confirm: "short") != nil
        && ProfileRules.passwordProblem("longenough", confirm: "different") != nil
        && ProfileRules.passwordProblem("longenough", confirm: "longenough") == nil)
  check("blank name refused, blank email is none", ProfileRules.cleanName("  ") == nil && ProfileRules.cleanEmail(" ") == nil && ProfileRules.cleanName(" Bob ") == "Bob")
} catch {
  failures += 1
  print("  ✗ profile threw: \(error)")
}

section("set editing")
do {
  let setJSON = #"{"id":"s1","label":"Sunday","startsAt":"2026-11-01T17:00:00.000Z","durationMinutes":90,"notes":null,"requiresMD":false,"isPrivate":false,"mdUserId":null,"slotCapacities":null,"groupChatLeadDays":null,"teamId":"t1","team":null,"org":null,"assignments":[{"id":"a1","role":"BASS","status":"PENDING","user":{"id":"u1","name":"Dave"},"guestTeamId":null,"pendingFromUser":null},{"id":"a2","role":"KEYS","status":"CONFIRMED","user":{"id":"u2","name":"Ivy"},"guestTeamId":null,"pendingFromUser":null}],"songs":[{"id":"x2","title":"Second","key":"G","order":1},{"id":"x1","title":"First","key":null,"order":0}],"spotifyPlaylistUrl":null,"practices":[],"guestTeams":[]}"#
  let set = try TapWorship.makeDecoder().decode(ApiSet.self, from: Data(setJSON.utf8))
  check("anyone on the set may edit its setlist", Setlist.canEdit(set, userId: "u1", isOrgAdmin: false) && !Setlist.canEdit(set, userId: "zz", isOrgAdmin: false))
  let drafts = Setlist.drafts(from: set.songs)
  check("setlist opens in its saved order", drafts.map(\.title) == ["First", "Second"])
  check("an untouched setlist isn't a change", !Setlist.changed(drafts, from: set.songs))
  var edited = drafts + [Setlist.Draft(title: "   ", key: nil), Setlist.Draft(title: " Third ", key: "H#")]
  edited.swapAt(0, 1)
  check("blank songs dropped, titles trimmed, bad keys cleared", Setlist.body(edited) == [.init(title: "Second", key: "G"), .init(title: "First", key: nil), .init(title: "Third", key: nil)])
  check("a reorder is a change", Setlist.changed(edited, from: set.songs))

  var seats = RosterEditing.seats(of: set)
  check("no edit, no diff", RosterEditing.diff(original: set, edited: seats).isEmpty)
  seats.removeAll { $0.assignmentId == "a2" }
  seats[0].userId = "u9"; seats[0].name = "Zed"
  seats.append(SeatDraft(assignmentId: nil, role: "DRUMS", userId: "u3", name: "Ruth", guestTeamId: nil))
  let diff = RosterEditing.diff(original: set, edited: seats)
  check("diff: removed, reassigned, added", diff.removed == ["a2"] && diff.reassigned == [.init(id: "a1", userId: "u9")] && diff.added == [.init(role: "DRUMS", userId: "u3", guestTeamId: nil)])
  check("diff summary", RosterEditing.summary(diff) == "1 added, 1 changed, 1 removed")

  let users = [
    ApiAdminUser(id: "u1", name: "Dave", username: "dave", isMD: false, isAdmin: false, teams: [.init(id: "t1", name: "Sunday", roles: ["BASS"], active: true)]),
    ApiAdminUser(id: "u4", name: "Abe", username: "abe", isMD: false, isAdmin: false, teams: [.init(id: "t1", name: "Sunday", roles: ["BASS"], active: false)]),
    ApiAdminUser(id: "u5", name: "Bea", username: "bea", isMD: false, isAdmin: false, teams: [.init(id: "t2", name: "Youth", roles: ["BASS"], active: true)]),
    ApiAdminUser(id: "u6", name: "Cy", username: "cy", isMD: false, isAdmin: false, teams: [.init(id: "t1", name: "Sunday", roles: ["BASS"], active: true)]),
  ]
  let options = RosterEditing.candidates(users: users, role: "BASS", teamId: "t1", taken: ["u1"])
  check("candidates: this team's players, not already seated, paused last", options.map(\.name) == ["Cy", "Abe"] && options.last?.inactive == true)
  check("a set with no team draws on every team", RosterEditing.candidates(users: users, role: "BASS", teamId: nil, taken: []).count == 4)

  let start = Date(timeIntervalSince1970: 1_800_000_000)
  check("a new set's duration comes from its end", NewSet(label: "  ", startsAt: start, endsAt: start.addingTimeInterval(5400), teamId: "t1").durationMinutes == 90)
  check("a blank label is none, a backwards set is refused", NewSet(label: " ", startsAt: start, endsAt: start, teamId: "t1").label == nil && NewSet(label: nil, startsAt: start, endsAt: start, teamId: "t1").problem != nil)
  check("practice must end after it starts", PracticeRules.problem(start: start, end: start) != nil && PracticeRules.problem(start: start, end: start.addingTimeInterval(60)) == nil)
  let body = String(data: try TapWorship.makeEncoder().encode(NewSet(label: "Easter", startsAt: start, endsAt: start.addingTimeInterval(3600), teamId: "t1")), encoding: .utf8) ?? ""
  check("a new set's start is sent as an ISO date", body.contains("\"startsAt\":\"2027-01-15T08:00:00"))
} catch {
  failures += 1
  print("  ✗ set editing threw: \(error)")
}

section("read-only preview")
check("reads pass", ReadOnly.allows(method: "GET", path: "/api/sets?from=x") && ReadOnly.allows(method: "get", path: "/api/me"))
check("signing in passes", ReadOnly.allows(method: "POST", path: "/api/mobile/session") && ReadOnly.allows(method: "POST", path: "/api/mobile/session/social"))
check("every write is refused", !ReadOnly.allows(method: "PATCH", path: "/api/assignments/a1") && !ReadOnly.allows(method: "DELETE", path: "/api/me")
      && !ReadOnly.allows(method: "PUT", path: "/api/me") && !ReadOnly.allows(method: "POST", path: "/api/orgs/join")
      && !ReadOnly.allows(method: "POST", path: "/api/mobile/session/other"))
do {
  final class Box: @unchecked Sendable { var hits = 0 }
  let box = Box()
  let api = APIClient(baseURL: URL(string: "https://tapworship.com")!, readOnly: true, token: { "t" }) { request in
    box.hits += 1
    return (Data("{}".utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
  let semaphore = DispatchSemaphore(value: 0)
  final class Result: @unchecked Sendable { var error: APIError? }
  let result = Result()
  Task {
    do { try await api.deleteAccount(confirm: "DELETE") } catch let e as APIError { result.error = e } catch {}
    semaphore.signal()
  }
  semaphore.wait()
  check("a refused write never reaches the network", result.error == .readOnly && box.hits == 0)
}

section("badges")
do {
  let json = #"{"swapCount":2,"availability":{"items":[{"request":{"id":"r1"},"needsResponse":true},{"request":{"id":"r2"},"needsResponse":false}],"needsResponse":true},"needsRoles":false,"teamless":[],"approvalCount":3}"#
  let n = try TapWorship.makeDecoder().decode(ApiNotifications.self, from: Data(json.utf8))
  check("badges decode", n.swapCount == 2 && n.approvalCount == 3 && !n.needsRoles)
  check("availability badge counts requests still owed", n.availabilityOwed == 1)
  let api = APIClient(baseURL: URL(string: "https://tapworship.com")!, token: { "t" })
  let badgeRequest = try api.makeRequest("GET", "/api/notifications?orgId=o1")
  check("badge request names the admin org", badgeRequest.url?.query == "orgId=o1")
} catch {
  failures += 1
  print("  ✗ badges threw: \(error)")
}

section("sign up")
do {
  var form = SignUpForm(firstName: " Ann ", lastName: "Lee", email: " Ann@Example.COM ", password: "longenough", orgKey: " key ")
  check("a complete form passes", form.problem(confirm: "longenough") == nil)
  check("cleaned like the server", form.cleaned.email == "ann@example.com" && form.cleaned.firstName == "Ann" && form.cleaned.orgKey == "key")
  check("passwords must match", form.problem(confirm: "different") != nil)
  form.orgKey = "  "
  check("the org key is required in the app", form.problem(confirm: "longenough") != nil)
  check("email shape", SignUpForm.looksLikeEmail("a@b.co") && !SignUpForm.looksLikeEmail("a@b") && !SignUpForm.looksLikeEmail("a b@c.d") && !SignUpForm.looksLikeEmail("@b.co"))
  let body = String(data: try TapWorship.makeEncoder().encode(SignUpForm(firstName: "A", lastName: "B", email: "a@b.co", password: "x", orgKey: "k")), encoding: .utf8) ?? ""
  check("sign-up body has the server's field names", body.contains("\"firstName\"") && body.contains("\"orgKey\"") && body.contains("\"allowDuplicateName\":false"))
  check("signing up is refused in the read-only preview", !ReadOnly.allows(method: "POST", path: "/api/signup"))
} catch {
  failures += 1
  print("  ✗ sign up threw: \(error)")
}

do {
  let wire = #"[{"id":"u1","name":"Jo","username":"jo@example.com","isMD":false,"isAdmin":false,"teams":[],"signInWith":"google"},{"id":"u2","name":"Al","username":"al","isMD":false,"isAdmin":true,"teams":[],"signInWith":null}]"#
  let people = try TapWorship.makeDecoder().decode([ApiAdminUser].self, from: Data(wire.utf8))
  check("members carry how they sign in", people[0].signInWith == "google" && people[1].signInWith == nil)
} catch { check("members carry how they sign in", false) }

// Week view
do {
  let evening = ApiUnavailability(id: "w1", type: .specific, startMinute: 18 * 60, endMinute: 21 * 60, startDate: laDay("2026-11-24"))
  let overlap = ApiUnavailability(id: "w2", type: .specific, startMinute: 19 * 60, endMinute: 20 * 60, startDate: laDay("2026-11-24"))
  let later = ApiUnavailability(id: "w3", type: .specific, startMinute: 21 * 60, endMinute: 22 * 60, startDate: laDay("2026-11-24"))
  let blocks = WeekView.dayBlocks([evening, overlap, later], on: "2026-11-24", calendar: la)
  check("week: overlapping blocks share lanes", blocks.first { $0.id == "w1" }?.lanes == 2 && blocks.first { $0.id == "w2" }?.lane == 1)
  check("week: a block after the cluster gets the full width", blocks.first { $0.id == "w3" }?.lanes == 1)
  let g1 = ApiUnavailability(id: "g1", type: .specific, startMinute: 600, endMinute: 720, startDate: laDay("2026-11-24"), fromGoogle: true)
  let g2 = ApiUnavailability(id: "g2", type: .specific, startMinute: 700, endMinute: 800, startDate: laDay("2026-11-24"), fromGoogle: true)
  let imported = WeekView.dayBlocks([g1, g2], on: "2026-11-24", calendar: la)
  check("week: overlapping imports merge", imported.count == 1 && imported[0].endMinute == 800 && imported[0].kind == .google)
  check("week: weekly repeats are their own kind", WeekView.dayBlocks([everyTuesday], on: "2026-11-24", calendar: la).first?.kind == .recurring)
  let clipped = WeekView.clipped(WeekView.dayBlocks([everyTuesday], on: "2026-11-24", calendar: la))
  check("week: all day clips to the view's hours", clipped.first?.top == 360 && clipped.first?.bottom == 1320)
  check("week: starts on Sunday", SetCalendar.ymd(WeekView.weekStart(laDay("2026-11-26"), calendar: la), calendar: la) == "2026-11-22")
}

// ── Result ──────────────────────────────────────────────────────────────
print("\n\(ran - failures)/\(ran) checks passed")
if failures > 0 {
  print("\(failures) FAILED")
  exit(1)
}
print("OK")
