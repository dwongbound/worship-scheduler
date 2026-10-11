import Foundation
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

// ── Result ──────────────────────────────────────────────────────────────
print("\n\(ran - failures)/\(ran) checks passed")
if failures > 0 {
  print("\(failures) FAILED")
  exit(1)
}
print("OK")
