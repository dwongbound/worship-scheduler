import Foundation

// Signing in. The server side is POST /api/mobile/session (lib/mobileToken.ts
// in the web project): username-or-email + password in, a bearer token out.
// The token is the web session's own NextAuth JWT, so there is nothing here to
// refresh or revoke — signing out is forgetting it.

public struct SessionMembership: Codable, Hashable, Sendable {
  public let orgId: String
  /// A UI hint only; every admin route re-checks the db.
  public let isAdmin: Bool

  public init(orgId: String, isAdmin: Bool) {
    self.orgId = orgId
    self.isAdmin = isAdmin
  }
}

public struct SessionUser: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let name: String?
  public let email: String?
  public let memberships: [SessionMembership]

  public init(id: String, name: String?, email: String?, memberships: [SessionMembership]) {
    self.id = id
    self.name = name
    self.email = email
    self.memberships = memberships
  }

  /// Signed in but in no org yet: the web sends these people to /join.
  public var hasNoOrg: Bool { memberships.isEmpty }
}

public struct MobileSession: Codable, Hashable, Sendable {
  public let token: String
  public let expiresAt: Date
  public let user: SessionUser

  public init(token: String, expiresAt: Date, user: SessionUser) {
    self.token = token
    self.expiresAt = expiresAt
    self.user = user
  }

  /// A token past its expiry is refused by the server anyway; checking here
  /// just saves a round trip that would only ever answer 401.
  public func isExpired(now: Date = Date()) -> Bool { expiresAt <= now }
}
