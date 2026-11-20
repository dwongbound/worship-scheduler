import Foundation

// Editing a set from the app, matching the web's set modal on a phone: the
// setlist (admins and anyone on the set), and for admins the roster, practices,
// deleting the set and creating a one-off one.

// MARK: Setlist

public enum Setlist {
  /// lib/constants.ts SONG_KEYS — the only keys the server keeps.
  public static let keys = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
  public static let maxSongs = 50
  public static let maxTitleLength = 200

  /// Who may edit the setlist: an org admin, or anyone with a seat on the set
  /// (PUT /api/sets/[id]/songs enforces the same).
  public static func canEdit(_ set: ApiSet, userId: String?, isOrgAdmin: Bool) -> Bool {
    if isOrgAdmin { return true }
    guard let userId else { return false }
    return set.assignments.contains { $0.user.id == userId }
  }

  /// One row while editing. `id` is local, so a reorder or a retyped title
  /// keeps its row.
  public struct Draft: Identifiable, Hashable, Sendable {
    public let id: UUID
    public var title: String
    public var key: String?
    public init(id: UUID = UUID(), title: String, key: String?) {
      self.id = id; self.title = title; self.key = key
    }
  }

  public static func drafts(from songs: [ApiSong]?) -> [Draft] {
    (songs ?? []).sorted { $0.order < $1.order }.map { Draft(title: $0.title, key: $0.key) }
  }

  public struct SongBody: Encodable, Equatable, Sendable {
    public let title: String
    public let key: String?
    public init(title: String, key: String?) { self.title = title; self.key = key }
    public func encode(to encoder: Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(title, forKey: .title)
      try c.encode(key, forKey: .key)
    }
    private enum CodingKeys: String, CodingKey { case title, key }
  }

  /// What to send: blank titles dropped, titles trimmed and capped, unknown
  /// keys cleared (the server would clear them anyway).
  public static func body(_ drafts: [Draft]) -> [SongBody] {
    drafts.compactMap { draft in
      let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !title.isEmpty else { return nil }
      let key = draft.key.flatMap { keys.contains($0) ? $0 : nil }
      return SongBody(title: String(title.prefix(maxTitleLength)), key: key)
    }
  }

  /// Whether the edit differs from what's saved.
  public static func changed(_ drafts: [Draft], from songs: [ApiSong]?) -> Bool {
    body(drafts) != body(Self.drafts(from: songs))
  }
}

// MARK: Roster

/// One seat while an admin edits a roster. `assignmentId` is nil for a seat
/// added in this edit.
public struct SeatDraft: Identifiable, Hashable, Sendable {
  public let id: UUID
  public let assignmentId: String?
  public let role: RoleKey
  public var userId: String
  public var name: String
  public let guestTeamId: String?

  public init(id: UUID = UUID(), assignmentId: String?, role: RoleKey, userId: String, name: String, guestTeamId: String?) {
    self.id = id; self.assignmentId = assignmentId; self.role = role
    self.userId = userId; self.name = name; self.guestTeamId = guestTeamId
  }
}

/// PATCH /api/admin/sets/[id]/roster — the whole diff in one request
/// (lib/setDraft.ts diffAssignments makes the same shape).
public struct RosterDiff: Codable, Equatable, Sendable {
  public struct Reassign: Codable, Equatable, Sendable {
    public let id: String
    public let userId: String
    public init(id: String, userId: String) { self.id = id; self.userId = userId }
  }
  public struct Add: Codable, Equatable, Sendable {
    public let role: RoleKey
    public let userId: String
    public let guestTeamId: String?
    public init(role: RoleKey, userId: String, guestTeamId: String?) {
      self.role = role; self.userId = userId; self.guestTeamId = guestTeamId
    }
  }
  public var removed: [String]
  public var reassigned: [Reassign]
  public var added: [Add]

  public var isEmpty: Bool { removed.isEmpty && reassigned.isEmpty && added.isEmpty }
}

public enum RosterEditing {
  /// Today's roster as editable seats.
  public static func seats(of set: ApiSet) -> [SeatDraft] {
    set.assignments.map {
      SeatDraft(assignmentId: $0.id, role: $0.role, userId: $0.user.id, name: $0.user.name, guestTeamId: $0.guestTeamId)
    }
  }

  /// What changed between the saved roster and the edit.
  public static func diff(original: ApiSet, edited: [SeatDraft]) -> RosterDiff {
    let keptIds = Set(edited.compactMap(\.assignmentId))
    let removed = original.assignments.map(\.id).filter { !keptIds.contains($0) }
    let byId = Dictionary(uniqueKeysWithValues: original.assignments.map { ($0.id, $0) })
    let reassigned = edited.compactMap { seat -> RosterDiff.Reassign? in
      guard let id = seat.assignmentId, let before = byId[id], before.user.id != seat.userId else { return nil }
      return .init(id: id, userId: seat.userId)
    }
    let added = edited.filter { $0.assignmentId == nil }.map {
      RosterDiff.Add(role: $0.role, userId: $0.userId, guestTeamId: $0.guestTeamId)
    }
    return RosterDiff(removed: removed, reassigned: reassigned, added: added)
  }

  /// The diff as one sentence for the confirm ("2 added, 1 removed").
  public static func summary(_ diff: RosterDiff) -> String {
    var parts: [String] = []
    if !diff.added.isEmpty { parts.append("\(diff.added.count) added") }
    if !diff.reassigned.isEmpty { parts.append("\(diff.reassigned.count) changed") }
    if !diff.removed.isEmpty { parts.append("\(diff.removed.count) removed") }
    return parts.isEmpty ? "No changes" : parts.joined(separator: ", ")
  }

  /// One of the set's own team's roles, in the team's order, with how many
  /// seats the set wants in it.
  public struct EditableRole: Identifiable, Hashable, Sendable {
    public let key: RoleKey
    public let label: String
    public let capacity: Int
    public var id: RoleKey { key }
  }

  /// The roles an admin can staff from the app: the owning team's, the way
  /// the roster shows them. (Borrowed guest-team roles are added on the web.)
  public static func editableRoles(_ set: ApiSet) -> [EditableRole] {
    let catalog = set.team?.roles ?? SetCalendar.defaultCatalog
    return SetCalendar.slotted(catalog).compactMap { role in
      let capacity = set.slotCapacities?[role.key] ?? role.defaultCount
      let seated = set.assignments.contains { $0.guestTeamId == nil && $0.role == role.key }
      guard capacity > 0 || seated else { return nil }
      return EditableRole(key: role.key, label: role.label, capacity: capacity)
    }
  }

  public struct Candidate: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    /// Paused on this set's team: not auto-scheduled, still pickable.
    public let inactive: Bool
  }

  /// Who can fill `role` on this set (lib/playerOptions.ts, minus the
  /// availability flag): people who play it on the set's team — or on any
  /// team when the set has none — and aren't already in that role here.
  /// Nobody is filtered out for being paused; they sink to the bottom.
  public static func candidates(
    users: [ApiAdminUser], role: RoleKey, teamId: String?, taken: Set<String>
  ) -> [Candidate] {
    users.compactMap { user -> Candidate? in
      guard !taken.contains(user.id) else { return nil }
      let teams = teamId.map { id in user.teams.filter { $0.id == id } } ?? user.teams
      guard teams.contains(where: { $0.roles.contains(role) }) else { return nil }
      let inactive = teamId.map { id in user.teams.first { $0.id == id }?.active == false }
        ?? (!user.teams.isEmpty && user.teams.allSatisfy { !$0.active })
      return Candidate(id: user.id, name: user.name, inactive: inactive)
    }
    .sorted { a, b in
      if a.inactive != b.inactive { return !a.inactive }
      return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
    }
  }
}

// MARK: Practices and new sets

public enum PracticeRules {
  /// A practice needs a start before its end (lib/practices.ts
  /// validateSetPractice checks the rest: same-instant clashes and the cap).
  public static func problem(start: Date, end: Date) -> String? {
    end > start ? nil : "The practice has to end after it starts."
  }
}

/// POST /api/sets — a one-off set on one team.
public struct NewSet: Encodable, Equatable, Sendable {
  public var label: String?
  public var startsAt: Date
  public var durationMinutes: Int
  public var teamId: String

  public init(label: String?, startsAt: Date, endsAt: Date, teamId: String) {
    let trimmed = label?.trimmingCharacters(in: .whitespacesAndNewlines)
    self.label = (trimmed?.isEmpty ?? true) ? nil : trimmed
    self.startsAt = startsAt
    self.durationMinutes = max(0, Int(endsAt.timeIntervalSince(startsAt) / 60))
    self.teamId = teamId
  }

  public var problem: String? {
    durationMinutes > 0 ? nil : "The set has to end after it starts."
  }
}

extension APIClient {
  public func saveSetlist(setId: String, songs: [Setlist.SongBody]) async throws {
    struct Body: Encodable { let songs: [Setlist.SongBody] }
    let _: Ignored = try await send("PUT", "/api/sets/\(setId)/songs", body: Body(songs: songs))
  }

  public func saveRoster(setId: String, diff: RosterDiff) async throws {
    let _: Ignored = try await send("PATCH", "/api/admin/sets/\(setId)/roster", body: diff)
  }

  public func addPractice(setId: String, startsAt: Date, endsAt: Date) async throws {
    struct Body: Encodable { let startsAt: Date; let endsAt: Date }
    let _: Ignored = try await send("POST", "/api/sets/\(setId)/practices", body: Body(startsAt: startsAt, endsAt: endsAt))
  }

  public func deletePractice(setId: String, practiceId: String) async throws {
    let _: Ignored = try await send("DELETE", "/api/sets/\(setId)/practices/\(practiceId)")
  }

  public func deleteSet(_ setId: String) async throws {
    let _: Ignored = try await send("DELETE", "/api/sets/\(setId)")
  }

  public func createSet(_ newSet: NewSet) async throws {
    let _: Ignored = try await send("POST", "/api/sets", body: newSet)
  }
}
