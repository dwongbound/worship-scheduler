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
