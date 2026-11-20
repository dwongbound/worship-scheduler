import Foundation

// What a set's page does beyond showing it, matching the web's set modal on a
// phone: the notes log and composer, who's free for a practice, and My Sets'
// "Confirm all".

/// One entry in a set's activity log (GET /api/sets/[id]/history).
public struct ApiSetHistoryEvent: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let type: String
  public let detail: String?
  public let createdAt: Date
  public let actor: ApiUserRef?
}

/// GET /api/sets/[id]/practices/[practiceId]/availability.
public struct PracticeAvailability: Codable, Hashable, Sendable {
  public struct Person: Codable, Hashable, Identifiable, Sendable {
    public let userId: String
    public let name: String
    public let roles: [RoleKey]
    public let free: Bool
    public var id: String { userId }
  }
  public let people: [Person]

  /// Free people first, then busy, each alphabetical — who you can count on
  /// reads at the top.
  public var sorted: [Person] {
    people.sorted { a, b in
      if a.free != b.free { return a.free }
      return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
    }
  }
}

public enum SetNotes {
  /// Who may post a note: an org admin, or the set's worship leader (the web's
  /// `canEditNotes` in SetDetailModal; the PATCH route enforces the same).
  public static func canPost(on set: ApiSet, userId: String?, isOrgAdmin: Bool) -> Bool {
    if isOrgAdmin { return true }
    guard let userId else { return false }
    return set.assignments.contains { $0.role == "WORSHIP_LEADER" && $0.user.id == userId }
  }

  /// The note itself out of a logged line (lib/setNotes.ts noteTextFromDetail):
  /// `added a note: "Bring cables"` → `Bring cables`; a line with no quoted
  /// excerpt ("cleared the notes") comes back as it is.
  public static func text(fromDetail detail: String?) -> String {
    let text = (detail ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard let open = text.firstIndex(of: "\""), text.hasSuffix("\""), text.index(after: open) < text.endIndex else { return text }
    let inner = text[text.index(after: open)..<text.index(before: text.endIndex)]
    return String(inner)
  }

  /// The text to send, or nil when there's nothing to say.
  public static func ready(_ draft: String) -> String? {
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
  }
}

extension APIClient {
  /// The set's NOTES_CHANGED entries, newest first.
  public func noteLog(setId: String) async throws -> [ApiSetHistoryEvent] {
    try await send("GET", "/api/sets/\(setId)/history?types=NOTES_CHANGED")
  }

  /// Post a note. Like the web, the latest note becomes the set's notes and
  /// the server logs the change.
  public func postNote(setId: String, text: String) async throws {
    struct Body: Encodable { let notes: String }
    let _: Ignored = try await send("PATCH", "/api/sets/\(setId)", body: Body(notes: text))
  }

  public func practiceAvailability(setId: String, practiceId: String) async throws -> PracticeAvailability {
    try await send("GET", "/api/sets/\(setId)/practices/\(practiceId)/availability")
  }

  /// Confirm every pending seat of mine. Answers how many changed.
  public func confirmAll() async throws -> Int {
    struct Answer: Decodable { let confirmed: Int }
    let answer: Answer = try await send("POST", "/api/assignments/confirm-all")
    return answer.confirmed
  }
}
