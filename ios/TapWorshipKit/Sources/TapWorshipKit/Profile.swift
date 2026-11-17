import Foundation

// The web's /profile, for the app: GET /api/me and PUT /api/me.

/// GET /api/me — who I am, as /profile reads it.
public struct ApiProfile: Codable, Hashable, Sendable {
  public struct Membership: Codable, Hashable, Sendable {
    public let orgId: String
    public let orgName: String
    public let isAdmin: Bool
  }
  public struct Team: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let orgId: String
    /// Role keys I play on this team.
    public let roles: [RoleKey]
    /// What the team offers, for labels and order.
    public let catalog: [TeamRoleDef]
    /// Off = paused here: not auto-scheduled on this team.
    public let active: Bool

    /// My roles here as labels, in the team's own order.
    public var roleLabels: [String] {
      let ordered = catalog.sorted { $0.order < $1.order }.filter { roles.contains($0.key) }.map(\.label)
      let unknown = roles.filter { key in !catalog.contains { $0.key == key } }.map { RoleLabels.label(for: $0) }
      return ordered + unknown
    }
  }

  public let username: String?
  public let name: String?
  public let email: String?
  public let dailyDigest: Bool
  public let calendarInvites: Bool
  public let calendarInviteEmails: Bool
  /// Where invites go instead of `email`; nil = `email`.
  public let calendarInviteEmail: String?
  /// False for a Google/Apple-only account: no password to change, and its
  /// email is the provider's, not editable here.
  public let hasPassword: Bool
  public let memberships: [Membership]
  public let teams: [Team]

  /// The address invites actually go to (lib/calendarEvent.ts inviteAddress).
  public var inviteAddress: String? {
    let override = calendarInviteEmail?.trimmingCharacters(in: .whitespaces)
    if let override, !override.isEmpty { return override }
    return email
  }

  /// Which org a team belongs to, by name.
  public func orgName(for team: Team) -> String? {
    memberships.first { $0.orgId == team.orgId }?.orgName
  }
}

/// The body of PUT /api/me. The server REQUIRES `name` on every save and
/// treats a missing `email` as "clear it", so both always go; the rest are
/// sent only when set, so saving one switch can't reset another.
public struct ProfileUpdate: Encodable, Equatable, Sendable {
  public var name: String
  public var email: String?
  public var password: String?
  public var dailyDigest: Bool?
  public var calendarInvites: Bool?
  public var calendarInviteEmails: Bool?
  /// Only with calendarInvites = false: also take me off invites already sent.
  public var withdrawInvites: Bool?

  /// A save that keeps my name and email as they are.
  public init(keeping me: ApiProfile) {
    self.name = me.name ?? ""
    self.email = me.email
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(name, forKey: .name)
    // Explicit null, never missing: missing reads as "clear it" too, but say so.
    try c.encode(email, forKey: .email)
    try c.encodeIfPresent(password, forKey: .password)
    try c.encodeIfPresent(dailyDigest, forKey: .dailyDigest)
    try c.encodeIfPresent(calendarInvites, forKey: .calendarInvites)
    try c.encodeIfPresent(calendarInviteEmails, forKey: .calendarInviteEmails)
    try c.encodeIfPresent(withdrawInvites, forKey: .withdrawInvites)
  }

  private enum CodingKeys: String, CodingKey {
    case name, email, password, dailyDigest, calendarInvites, calendarInviteEmails, withdrawInvites
  }
}

public enum ProfileRules {
  /// The web's minimum (PUT /api/me refuses shorter).
  public static let minPasswordLength = 8

  /// Why a new password can't be saved yet, or nil when it can.
  public static func passwordProblem(_ password: String, confirm: String) -> String? {
    if password.count < minPasswordLength { return "Use at least \(minPasswordLength) characters." }
    if password != confirm { return "The two passwords don't match." }
    return nil
  }

  /// A name worth saving: not blank once trimmed.
  public static func cleanName(_ name: String) -> String? {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  /// Blank email = none.
  public static func cleanEmail(_ email: String) -> String? {
    let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }
}

extension APIClient {
  /// Everything /profile shows (the admin tab's `me()` reads a slimmer shape).
  public func profile() async throws -> ApiProfile {
    try await send("GET", "/api/me")
  }

  public func updateProfile(_ update: ProfileUpdate) async throws {
    let _: Ignored = try await send("PUT", "/api/me", body: update)
  }
}
