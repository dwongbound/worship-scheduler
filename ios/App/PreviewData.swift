import Foundation
import TapWorshipKit

// Realistic, invented data for #Previews and the loading placeholder. Built
// by decoding JSON through the app's own decoder, so a preview can't show a
// shape the server would never send.
enum PreviewData {
  static let assignments: [ApiMyAssignment] = {
    let soon = Date().addingTimeInterval(2 * 86_400)
    let later = Date().addingTimeInterval(9 * 86_400)
    let iso = ISO8601DateFormatter()
    let json = """
    [
      { "id": "a1", "role": "KEYS", "status": "PENDING", "pendingSwap": null,
        "set": { "id": "s1", "label": "Sunday Service", "startsAt": "\(iso.string(from: soon))",
                 "durationMinutes": 90, "notes": "Run-through at 8:30 in the sanctuary.",
                 "isPrivate": false, "org": { "id": "o1", "name": "Grace Chapel" } } },
      { "id": "a2", "role": "VOCALS", "status": "CONFIRMED", "pendingSwap": null,
        "set": { "id": "s1", "label": "Sunday Service", "startsAt": "\(iso.string(from: soon))",
                 "durationMinutes": 90, "notes": "Run-through at 8:30 in the sanctuary.",
                 "isPrivate": false, "org": { "id": "o1", "name": "Grace Chapel" } } },
      { "id": "a3", "role": "ELECTRIC_GUITAR", "status": "SWAP_REQUESTED", "pendingSwap": null,
        "set": { "id": "s2", "label": "Large Group Night With A Very Long Name That Wraps",
                 "startsAt": "\(iso.string(from: later))", "durationMinutes": 60, "notes": null,
                 "isPrivate": false, "org": { "id": "o1", "name": "Grace Chapel" } } }
    ]
    """
    return (try? TapWorship.makeDecoder().decode([ApiMyAssignment].self, from: Data(json.utf8))) ?? []
  }()

  static var groups: [MySets.SetGroup] { MySets.grouped(assignments) }

  static let session = MobileSession(
    token: "preview",
    expiresAt: Date().addingTimeInterval(30 * 86_400),
    user: SessionUser(id: "u1", name: "Sam Rivera", email: "sam@example.com",
                      memberships: [SessionMembership(orgId: "o1", isAdmin: false)])
  )
}

extension AppModel {
  /// A model whose API answers from memory: no network, no Keychain.
  static func preview(
    signedIn: Bool,
    assignments: [ApiMyAssignment] = PreviewData.assignments,
    failWith error: Error? = nil
  ) -> AppModel {
    let body = (try? TapWorship.makeEncoder().encode(assignments)) ?? Data("[]".utf8)
    let api = APIClient(baseURL: AppConfig.productionURL, token: { "preview" }) { request in
      if let error { throw error }
      let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
      return (request.httpMethod == "GET" ? body : Data("{}".utf8), response)
    }
    return AppModel(previewSession: signedIn ? PreviewData.session : nil, api: api)
  }
}

// MARK: Admin

enum AdminPreviewData {
  static func iso(_ days: Double) -> String {
    ISO8601DateFormatter().string(from: Date().addingTimeInterval(days * 86_400))
  }

  static let meJSON = #"{"name":"Sam Rivera","email":"sam@example.com","memberships":[{"orgId":"o1","orgName":"Grace Chapel","isAdmin":true},{"orgId":"o2","orgName":"Hillside Youth","isAdmin":true}]}"#

  static let approvalsJSON = """
  [
    {"kind":"cover","id":"c1","role":"KEYS","reason":"Out of town for a wedding",
     "taker":{"id":"u3","name":"Priya Nair"},"originalOwner":{"id":"u1","name":"Jordan Lee"},
     "set":{"id":"s1","label":"Sunday Service","startsAt":"\(iso(3))"}},
    {"kind":"swap","id":"p1","role":"ELECTRIC_GUITAR","reason":null,
     "requester":{"id":"u2","name":"Marcus Bell"},"recipient":{"id":"u4","name":"Ana Torres"},
     "receive":{"id":"s2","label":"Sunday Service","startsAt":"\(iso(10))"},
     "giveUp":{"id":"s3","label":"Large Group Night","startsAt":"\(iso(6))"}}
  ]
  """

  static var approvals: [ApiApproval] {
    (try? TapWorship.makeDecoder().decode([ApiApproval].self, from: Data(approvalsJSON.utf8))) ?? []
  }

  static let teams: [ApiOrgTeam] = [
    ApiOrgTeam(id: "t1", name: "Band", orgId: "o1", roles: [
      TeamRoleDef(key: "WORSHIP_LEADER", label: "Worship Leader", defaultCount: 1, adminOnly: false, order: 0),
      TeamRoleDef(key: "VOCALS", label: "Vox", defaultCount: 3, adminOnly: false, order: 1),
      TeamRoleDef(key: "KEYS", label: "Keys", defaultCount: 1, adminOnly: false, order: 2),
      TeamRoleDef(key: "ELECTRIC_GUITAR", label: "Electric Guitar", defaultCount: 1, adminOnly: false, order: 3),
      TeamRoleDef(key: "BASS", label: "Bass", defaultCount: 1, adminOnly: false, order: 4),
    ]),
    ApiOrgTeam(id: "t2", name: "Choir", orgId: "o1", roles: [
      TeamRoleDef(key: "CHOIR", label: "Choir", defaultCount: 8, adminOnly: false, order: 0),
    ]),
  ]

  static let users: [ApiAdminUser] = [
    ApiAdminUser(id: "u1", name: "Jordan Lee", username: "jordan", isMD: false, isAdmin: false,
                 teams: [ApiMemberTeam(id: "t1", name: "Band", roles: ["KEYS", "VOCALS"], active: false)]),
    ApiAdminUser(id: "u2", name: "Marcus Bell", username: "marcus", isMD: true, isAdmin: true,
                 teams: [ApiMemberTeam(id: "t1", name: "Band", roles: ["ELECTRIC_GUITAR"], active: true),
                         ApiMemberTeam(id: "t2", name: "Choir", roles: ["CHOIR"], active: true)]),
    ApiAdminUser(id: "u3", name: "Priya Nair", username: "priya.nair.with.a.long.username", isMD: false, isAdmin: false,
                 teams: [ApiMemberTeam(id: "t1", name: "Band", roles: [], active: true)]),
    ApiAdminUser(id: "u5", name: "Theo Grant", username: "theo", isMD: false, isAdmin: false, teams: []),
  ]
}

extension AppModel {
  /// A signed-in admin whose API answers from memory, by path.
  static func adminPreview(approvals: String = AdminPreviewData.approvalsJSON, failWith error: Error? = nil) -> AppModel {
    let usersJSON = (try? TapWorship.makeEncoder().encode(AdminPreviewData.users)) ?? Data("[]".utf8)
    let teamsJSON = (try? TapWorship.makeEncoder().encode(AdminPreviewData.teams)) ?? Data("[]".utf8)
    let api = APIClient(baseURL: AppConfig.productionURL, token: { "preview" }) { request in
      let path = request.url?.path ?? ""
      if let error, path != "/api/me" { throw error }
      let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
      guard request.httpMethod == "GET" else { return (Data("{}".utf8), response) }
      switch path {
      case "/api/me": return (Data(AdminPreviewData.meJSON.utf8), response)
      case "/api/admin/approvals": return (Data(approvals.utf8), response)
      case "/api/admin/users": return (usersJSON, response)
      case "/api/teams": return (teamsJSON, response)
      default: return (Data("[]".utf8), response)
      }
    }
    let admin = MobileSession(
      token: "preview", expiresAt: Date().addingTimeInterval(30 * 86_400),
      user: SessionUser(id: "u2", name: "Marcus Bell", email: "marcus@example.com",
                        memberships: [SessionMembership(orgId: "o1", isAdmin: true), SessionMembership(orgId: "o2", isAdmin: true)])
    )
    return AppModel(previewSession: admin, api: api)
  }
}

// MARK: Calendar, availability, swaps

/// Invented data for the member tabs, spelled as the JSON the routes send.
enum FullPreviewData {
  static func iso(_ days: Double, hour: Int = 10) -> String {
    let calendar = Calendar.current
    let day = calendar.date(byAdding: .day, value: Int(days), to: calendar.startOfDay(for: Date())) ?? Date()
    let at = calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? day
    return ISO8601DateFormatter().string(from: at)
  }

  /// Midnight on the app's clock, as the server stores a blocked day.
  static func appDay(_ days: Int) -> String {
    let calendar = AppConfig.appCalendar
    let day = calendar.date(byAdding: .day, value: days, to: calendar.startOfDay(for: Date())) ?? Date()
    return ISO8601DateFormatter().string(from: day)
  }

  static let bandRoles = """
  [ {"key":"WORSHIP_LEADER","label":"Worship Leader","defaultCount":1,"adminOnly":false,"order":0},
    {"key":"VOCALS","label":"Vox","defaultCount":2,"adminOnly":false,"order":1},
    {"key":"KEYS","label":"Keys","defaultCount":1,"adminOnly":false,"order":2},
    {"key":"ELECTRIC_GUITAR","label":"Electric Guitar","defaultCount":1,"adminOnly":false,"order":3},
    {"key":"DRUMS","label":"Drums","defaultCount":1,"adminOnly":false,"order":4} ]
  """

  static var setsJSON: String {
    """
    [
      { "id": "s1", "label": "Sunday Service", "startsAt": "\(iso(2))", "durationMinutes": 90,
        "notes": "Run-through at 8:30 in the sanctuary.", "requiresMD": true, "isPrivate": false,
        "mdUserId": "u2", "slotCapacities": null, "teamId": "t1",
        "team": { "id": "t1", "name": "Band", "roles": \(bandRoles) },
        "org": { "id": "o1", "name": "Grace Chapel" },
        "assignments": [
          { "id": "a1", "role": "KEYS", "status": "PENDING", "user": { "id": "u1", "name": "Sam Rivera" } },
          { "id": "a2", "role": "VOCALS", "status": "CONFIRMED", "user": { "id": "u1", "name": "Sam Rivera" } },
          { "id": "a5", "role": "ELECTRIC_GUITAR", "status": "CONFIRMED", "user": { "id": "u2", "name": "Marcus Bell" } },
          { "id": "a6", "role": "WORSHIP_LEADER", "status": "SWAP_REQUESTED", "user": { "id": "u4", "name": "Ana Torres-Villanueva" } }
        ],
        "songs": [ { "id": "g1", "title": "Who Else", "key": "E", "order": 0 }, { "id": "g2", "title": "Goodness of God", "key": "A", "order": 1 } ],
        "practices": [ { "id": "p1", "startsAt": "\(iso(0, hour: 19))", "endsAt": "\(iso(0, hour: 21))" } ],
        "guestTeams": [] },
      { "id": "s2", "label": "Large Group Night With A Very Long Name That Wraps", "startsAt": "\(iso(2, hour: 19))",
        "durationMinutes": 60, "notes": null, "requiresMD": false, "isPrivate": false, "mdUserId": null,
        "slotCapacities": { "KEYS": 1, "VOCALS": 1 }, "teamId": "t1",
        "team": { "id": "t1", "name": "Band", "roles": \(bandRoles) },
        "org": { "id": "o1", "name": "Grace Chapel" },
        "assignments": [
          { "id": "b1", "role": "KEYS", "status": "CONFIRMED", "user": { "id": "u3", "name": "Priya Nair" } },
          { "id": "b2", "role": "VOCALS", "status": "CONFIRMED", "user": { "id": "u5", "name": "Theo Grant" } }
        ], "songs": [], "practices": [], "guestTeams": [] },
      { "id": "s3", "label": "Sunday Service", "startsAt": "\(iso(9))", "durationMinutes": 90, "notes": null,
        "requiresMD": true, "isPrivate": false, "mdUserId": null, "slotCapacities": null, "teamId": "t1",
        "team": { "id": "t1", "name": "Band", "roles": \(bandRoles) },
        "org": { "id": "o1", "name": "Grace Chapel" }, "assignments": [], "songs": [], "practices": [], "guestTeams": [] }
    ]
    """
  }

  static var sets: [ApiSet] {
    (try? TapWorship.makeDecoder().decode([ApiSet].self, from: Data(setsJSON.utf8))) ?? []
  }

  static var availabilityJSON: String {
    """
    { "entries": [
        { "id": "e1", "type": "RECURRING", "dayOfWeek": 2, "startMinute": 1080, "endMinute": 1260,
          "startDate": null, "endDate": null, "exceptDates": [], "requestId": null, "fromGoogle": false, "note": null },
        { "id": "e2", "type": "SPECIFIC", "dayOfWeek": null, "startMinute": 0, "endMinute": 1440,
          "startDate": "\(appDay(4))", "endDate": "\(appDay(6))", "exceptDates": [], "requestId": null, "fromGoogle": false, "note": null },
        { "id": "e3", "type": "SPECIFIC", "dayOfWeek": null, "startMinute": 540, "endMinute": 720,
          "startDate": "\(appDay(11))", "endDate": null, "exceptDates": [], "requestId": "q1", "fromGoogle": true, "note": null } ],
      "requests": [ { "id": "q1", "name": "December schedule", "startDate": "\(appDay(0))", "endDate": "\(appDay(30))",
                      "orgId": "o1", "createdAt": "\(iso(-3))", "org": { "id": "o1", "name": "Grace Chapel" } } ],
      "responses": [], "googleImport": false }
    """
  }

  static var coversJSON: String {
    """
    [ { "id": "c9", "role": "KEYS", "status": "SWAP_REQUESTED", "reason": "Out of town for a wedding",
        "set": { "id": "s8", "label": "Sunday Service", "startsAt": "\(iso(16))", "durationMinutes": 90, "notes": null,
                 "isPrivate": false, "org": { "id": "o1", "name": "Grace Chapel" } },
        "user": { "id": "u3", "name": "Priya Nair" } } ]
    """
  }

  static var proposalsJSON: String {
    """
    [ { "id": "p9", "role": "VOCALS", "requestedBy": { "id": "u5", "name": "Theo Grant" }, "reason": "Family in town that weekend",
        "giveUp": { "id": "s1", "label": "Sunday Service", "startsAt": "\(iso(2))", "org": { "id": "o1", "name": "Grace Chapel" } },
        "receive": { "id": "s3", "label": "Sunday Service", "startsAt": "\(iso(9))", "org": { "id": "o1", "name": "Grace Chapel" } } } ]
    """
  }

  static var candidatesJSON: String {
    """
    { "items": [
        { "toAssignmentId": "x1", "role": "VOCALS", "status": "CONFIRMED", "counterparty": { "id": "u5", "name": "Theo Grant" },
          "set": { "id": "s3", "label": "Sunday Service", "startsAt": "\(iso(9))", "durationMinutes": 90, "team": { "id": "t1", "name": "Band" } },
          "youAvailable": true, "theyAvailable": true, "theyInactive": false, "theyAlsoOnYourSet": [], "youAlsoOnTheirSet": [] },
        { "toAssignmentId": "x2", "role": "VOCALS", "status": "PENDING", "counterparty": { "id": "u4", "name": "Ana Torres-Villanueva" },
          "set": { "id": "s4", "label": "Large Group Night", "startsAt": "\(iso(13, hour: 19))", "durationMinutes": 60, "team": { "id": "t1", "name": "Band" } },
          "youAvailable": false, "theyAvailable": true, "theyInactive": true, "theyAlsoOnYourSet": ["WORSHIP_LEADER"], "youAlsoOnTheirSet": [] }
      ], "hasMore": false }
    """
  }
}

extension AppModel {
  /// A signed-in member whose API answers every member route from memory.
  static func fullPreview(
    sets: String? = nil,
    availability: String? = nil,
    candidates: String? = nil,
    failWith error: Error? = nil
  ) -> AppModel {
    let assignments = (try? TapWorship.makeEncoder().encode(PreviewData.assignments)) ?? Data("[]".utf8)
    let setsBody = sets ?? FullPreviewData.setsJSON
    let availabilityBody = availability ?? FullPreviewData.availabilityJSON
    let candidatesBody = candidates ?? FullPreviewData.candidatesJSON
    let covers = FullPreviewData.coversJSON
    let proposals = FullPreviewData.proposalsJSON
    let api = APIClient(baseURL: AppConfig.productionURL, token: { "preview" }) { request in
      if let error { throw error }
      let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
      guard request.httpMethod == "GET" else { return (Data("{}".utf8), response) }
      switch request.url?.path ?? "" {
      case "/api/assignments": return (assignments, response)
      case "/api/sets": return (Data(setsBody.utf8), response)
      case "/api/availability": return (Data(availabilityBody.utf8), response)
      case "/api/swaps": return (Data(covers.utf8), response)
      case "/api/swaps/proposals/incoming": return (Data(proposals.utf8), response)
      case "/api/swaps/candidates": return (Data(candidatesBody.utf8), response)
      case "/api/me": return (Data(#"{"name":"Sam Rivera","email":"sam@example.com","memberships":[{"orgId":"o1","orgName":"Grace Chapel","isAdmin":false}]}"#.utf8), response)
      default: return (Data("[]".utf8), response)
      }
    }
    return AppModel(previewSession: PreviewData.session, api: api)
  }
}
