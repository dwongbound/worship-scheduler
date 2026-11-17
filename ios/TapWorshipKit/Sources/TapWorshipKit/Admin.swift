import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// The admin half of the app: Approvals and Team, the two admin pages that
// are a phone's job (approve a cover from the parking lot; pause someone who
// just told you they're away). Mirrors app/approvals and app/users. The web's
// Create tab (generating a schedule) stays on the web: its review workspace
// refuses phone widths there too (lib/layout.ts PREVIEW_MIN_WIDTH).

/// One org I belong to, with its name — from GET /api/me.
public struct ApiMyOrg: Codable, Hashable, Identifiable, Sendable {
  public let orgId: String
  public let orgName: String
  public let isAdmin: Bool
  public var id: String { orgId }

  public init(orgId: String, orgName: String, isAdmin: Bool) {
    self.orgId = orgId
    self.orgName = orgName
    self.isAdmin = isAdmin
  }
}

public struct ApiMe: Codable, Hashable, Sendable {
  public let name: String
  public let email: String?
  public let memberships: [ApiMyOrg]

  public init(name: String, email: String?, memberships: [ApiMyOrg]) {
    self.name = name
    self.email = email
    self.memberships = memberships
  }

  /// The orgs whose admin pages I see, by name.
  public var adminOrgs: [ApiMyOrg] {
    memberships.filter(\.isAdmin).sorted { $0.orgName.localizedCaseInsensitiveCompare($1.orgName) == .orderedAscending }
  }
}

// MARK: Approvals

public struct ApprovalSetRef: Codable, Hashable, Sendable {
  public let id: String
  public let label: String?
  public let startsAt: Date

  public init(id: String, label: String?, startsAt: Date) {
    self.id = id
    self.label = label
    self.startsAt = startsAt
  }
}

/// A handoff waiting on an admin (GET /api/admin/approvals).
public enum ApiApproval: Decodable, Hashable, Identifiable, Sendable {
  /// Someone took an open cover request; the seat already shows them.
  case cover(id: String, role: RoleKey, reason: String?, taker: ApiUserRef, originalOwner: ApiUserRef?, set: ApprovalSetRef)
  /// Two people traded seats; both already show the new owner.
  case swap(id: String, role: RoleKey, reason: String?, requester: ApiUserRef, recipient: ApiUserRef, receive: ApprovalSetRef, giveUp: ApprovalSetRef)

  public var id: String {
    switch self {
    case .cover(let id, _, _, _, _, _), .swap(let id, _, _, _, _, _, _): id
    }
  }

  public var kind: String {
    switch self {
    case .cover: "cover"
    case .swap: "swap"
    }
  }

  public var role: RoleKey {
    switch self {
    case .cover(_, let role, _, _, _, _), .swap(_, let role, _, _, _, _, _): role
    }
  }

  /// The earliest set it touches — what the list sorts and dates rows by.
  public var firstDate: Date {
    switch self {
    case .cover(_, _, _, _, _, let set): set.startsAt
    case .swap(_, _, _, _, _, let receive, let giveUp): min(receive.startsAt, giveUp.startsAt)
    }
  }

  /// One sentence, the web's wording: who is taking what from whom.
  public var summary: String {
    let role = RoleLabels.label(for: self.role)
    switch self {
    case .cover(_, _, _, let taker, let owner, _):
      return "\(taker.name) is covering \(owner?.name ?? "someone") on \(role)"
    case .swap(_, _, _, let requester, let recipient, _, _):
      return "\(requester.name) and \(recipient.name) are trading \(role)"
    }
  }

  private enum Keys: String, CodingKey {
    case kind, id, role, reason, taker, originalOwner, set, requester, recipient, receive, giveUp
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    let id = try c.decode(String.self, forKey: .id)
    let role = try c.decode(RoleKey.self, forKey: .role)
    let reason = try c.decodeIfPresent(String.self, forKey: .reason)
    switch try c.decode(String.self, forKey: .kind) {
    case "cover":
      self = .cover(
        id: id, role: role, reason: reason,
        taker: try c.decode(ApiUserRef.self, forKey: .taker),
        originalOwner: try c.decodeIfPresent(ApiUserRef.self, forKey: .originalOwner),
        set: try c.decode(ApprovalSetRef.self, forKey: .set)
      )
    case "swap":
      self = .swap(
        id: id, role: role, reason: reason,
        requester: try c.decode(ApiUserRef.self, forKey: .requester),
        recipient: try c.decode(ApiUserRef.self, forKey: .recipient),
        receive: try c.decode(ApprovalSetRef.self, forKey: .receive),
        giveUp: try c.decode(ApprovalSetRef.self, forKey: .giveUp)
      )
    default:
      throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "Unknown approval kind")
    }
  }
}

public enum ApprovalDecision: String, Codable, Sendable {
  case approve
  case reject
}

// MARK: Team

public struct ApiMemberTeam: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let roles: [RoleKey]
  /// Inactive = not auto-scheduled on this team, still hand-pickable.
  public let active: Bool

  public init(id: String, name: String, roles: [RoleKey], active: Bool) {
    self.id = id
    self.name = name
    self.roles = roles
    self.active = active
  }
}

public struct ApiAdminUser: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let username: String
  public let isMD: Bool
  public let isAdmin: Bool
  public let teams: [ApiMemberTeam]

  public init(id: String, name: String, username: String, isMD: Bool, isAdmin: Bool, teams: [ApiMemberTeam]) {
    self.id = id
    self.name = name
    self.username = username
    self.isMD = isMD
    self.isAdmin = isAdmin
    self.teams = teams
  }

  /// On no team = scheduled for nothing — worth flagging to an admin.
  public var isOnNoTeam: Bool { teams.isEmpty }
  /// Paused everywhere they serve.
  public var isInactiveEverywhere: Bool { !teams.isEmpty && teams.allSatisfy { !$0.active } }
}

/// A team with its role catalog (GET /api/teams).
public struct ApiOrgTeam: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let orgId: String
  public let roles: [TeamRoleDef]

  public init(id: String, name: String, orgId: String, roles: [TeamRoleDef]) {
    self.id = id
    self.name = name
    self.orgId = orgId
    self.roles = roles
  }
}

/// PATCH /api/admin/users/:id — only the fields set are sent, and the route
/// applies only the fields it receives.
public struct MemberPatch: Encodable, Sendable {
  public struct TeamRoles: Encodable, Sendable {
    public let teamId: String
    public let roles: [RoleKey]
    public init(teamId: String, roles: [RoleKey]) { self.teamId = teamId; self.roles = roles }
  }
  public struct TeamActive: Encodable, Sendable {
    public let teamId: String
    public let active: Bool
    public init(teamId: String, active: Bool) { self.teamId = teamId; self.active = active }
  }

  public var isAdmin: Bool?
  public var isMD: Bool?
  public var teamIds: [String]?
  public var teamRoles: [TeamRoles]?
  public var teamActive: [TeamActive]?

  public init(
    isAdmin: Bool? = nil, isMD: Bool? = nil, teamIds: [String]? = nil,
    teamRoles: [TeamRoles]? = nil, teamActive: [TeamActive]? = nil
  ) {
    self.isAdmin = isAdmin
    self.isMD = isMD
    self.teamIds = teamIds
    self.teamRoles = teamRoles
    self.teamActive = teamActive
  }
}

public enum TeamList {
  /// The last section's title: people scheduled for nothing.
  public static let noTeamTitle = "On no team"

  /// Search by name or username, case- and accent-insensitive; blank = all.
  public static func filter(_ users: [ApiAdminUser], query: String) -> [ApiAdminUser] {
    let q = query.trimmingCharacters(in: .whitespaces)
    guard !q.isEmpty else { return users }
    return users.filter {
      $0.name.range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil
        || $0.username.range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil
    }
  }

  /// Sections by team, the way an admin thinks of the roster; people on no
  /// team get their own section last, since they're the ones to fix.
  public static func byTeam(_ users: [ApiAdminUser], teams: [ApiOrgTeam]) -> [(title: String, members: [ApiAdminUser])] {
    var out: [(String, [ApiAdminUser])] = teams.map { team in
      (team.name, users.filter { $0.teams.contains { $0.id == team.id } })
    }.filter { !$0.1.isEmpty }
    let teamless = users.filter(\.isOnNoTeam)
    if !teamless.isEmpty { out.append((noTeamTitle, teamless)) }
    return out.map { (title: $0.0, members: $0.1) }
  }
}

extension APIClient {
  public func me() async throws -> ApiMe {
    try await send("GET", "/api/me")
  }

  public func approvals(orgId: String) async throws -> [ApiApproval] {
    try await send("GET", "/api/admin/approvals", orgId: orgId)
  }

  public func decide(_ approval: ApiApproval, _ decision: ApprovalDecision, orgId: String) async throws {
    struct Body: Encodable { let kind: String; let id: String; let action: ApprovalDecision }
    let _: Ignored = try await send(
      "POST", "/api/admin/approvals",
      body: Body(kind: approval.kind, id: approval.id, action: decision), orgId: orgId
    )
  }

  public func adminUsers(orgId: String) async throws -> [ApiAdminUser] {
    try await send("GET", "/api/admin/users", orgId: orgId)
  }

  public func teams(orgId: String) async throws -> [ApiOrgTeam] {
    try await send("GET", "/api/teams?orgId=\(orgId)")
  }

  public func updateMember(_ userId: String, _ patch: MemberPatch, orgId: String) async throws {
    let _: Ignored = try await send("PATCH", "/api/admin/users/\(userId)", body: patch, orgId: orgId)
  }

  /// Takes them out of THIS org (their account stays). The route refuses removing yourself.
  public func removeMember(_ userId: String, orgId: String) async throws {
    let _: Ignored = try await send("DELETE", "/api/admin/users/\(userId)", orgId: orgId)
  }
}
