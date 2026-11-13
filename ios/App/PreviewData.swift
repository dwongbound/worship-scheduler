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
