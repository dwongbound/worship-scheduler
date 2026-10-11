import Foundation

// The JSON the existing API returns, as Swift values.
//
// These mirror lib/types.ts one-for-one and ON PURPOSE: the web app and this
// one talk to the same 70 routes, so a shape that drifts here is a bug that
// only shows up on a phone. Where a field is optional in TypeScript it is
// Optional here, including the ones that are merely absent from some
// endpoints rather than genuinely nullable — the wire can't tell those apart
// and neither should a decoder.

/// A role key (`"ELECTRIC_GUITAR"`, `"VOCALS"`, a team's own custom key…).
///
/// A String, not an enum, exactly as on the server: roles are per-team rows in
/// TeamRole, not a fixed set, so an enum here would fail to decode the moment
/// a team invents one. `TeamRoles.label(for:in:)` turns it into words.
public typealias RoleKey = String

public enum AssignmentStatus: String, Codable, Sendable {
  case pending = "PENDING"
  case confirmed = "CONFIRMED"
  case swapRequested = "SWAP_REQUESTED"
  case pendingSwap = "PENDING_SWAP"
  /// Taken or accepted, showing the new person, but not final until an admin
  /// approves it.
  case pendingApproval = "PENDING_APPROVAL"
}

/// How many seats of each role a set wants. `nil` on a set means "use the
/// team's default shape" — see TeamRoles.resolveCapacities.
public typealias SlotCapacityMap = [RoleKey: Int]

public struct ApiOrg: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let name: String
  /// MY role in this org, not the org's own property.
  public let isAdmin: Bool
}

public struct TeamRoleDef: Codable, Hashable, Sendable {
  /// Stable; this is what an Assignment stores.
  public let key: RoleKey
  /// Renameable display name.
  public let label: String
  public let defaultCount: Int
  public let adminOnly: Bool
  /// Admin-set display order. Position IS the order — see lib/teamRoles.ts.
  public let order: Int
}

public struct ApiTeam: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let orgId: String?
  public let slackChannelId: String?
  /// This team's role catalog, in order. Absent = fall back to the built-ins.
  public let roles: [TeamRoleDef]?
}

public struct ApiUserRef: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let name: String
  /// Musical director — global to the person, like their instruments.
  public let isMD: Bool?
}

public struct ApiAssignment: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let role: RoleKey
  public let status: AssignmentStatus
  public let user: ApiUserRef
  /// Set when this seat was borrowed from a guest team. Role keys are only
  /// unique within a team, so this is what tells a guest CHOIR seat apart from
  /// the owning team's own.
  public let guestTeamId: String?
  /// While a handoff waits on an admin the seat SHOWS the taker, but still
  /// belongs to this person — that's who the MD rules count.
  public let pendingFromUser: ApiUserRef?
}

public struct ApiSong: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let title: String
  /// One of SONG_KEYS, or nil for unspecified.
  public let key: String?
  public let order: Int
}

public struct ApiOrgRef: Codable, Hashable, Sendable {
  public let id: String
  public let name: String
}

public struct ApiSet: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let label: String?
  /// ISO-8601 on the wire; decoded with APIClient's `.iso8601` strategy.
  public let startsAt: Date
  public let durationMinutes: Int
  public let notes: String?
  public let requiresMD: Bool
  public let isPrivate: Bool
  /// The designated MD's userId, or nil.
  public let mdUserId: String?
  /// nil = the team's default shape.
  public let slotCapacities: SlotCapacityMap?
  public let groupChatLeadDays: Int?
  /// nil = open to the whole org (e.g. its team was deleted).
  public let teamId: String?
  public let team: ApiTeam?
  public let org: ApiOrgRef?
  public let assignments: [ApiAssignment]
  public let songs: [ApiSong]?
  public let spotifyPlaylistUrl: String?

  /// When the set ends — the server stores a start plus a duration, never an
  /// end, so every reader derives this the same way.
  public var endsAt: Date { startsAt.addingTimeInterval(TimeInterval(durationMinutes * 60)) }
}
