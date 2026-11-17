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

public enum SocialProvider: String, Codable, Sendable {
  case google
  case apple
}

/// An account already using the name a new sign-in offered (lib/nameConflict.ts).
public struct ExistingAccount: Codable, Hashable, Sendable {
  public let name: String
  /// What they'd sign in with instead.
  public let email: String

  public init(name: String, email: String) {
    self.name = name
    self.email = email
  }
}

/// Deleting my own account (lib/accountDeletion.ts — keep the phrase in step).
public enum AccountDeletion {
  public static let phrase = "DELETE"

  public static func matches(_ typed: String) -> Bool {
    typed.trimmingCharacters(in: .whitespaces) == phrase
  }
}

/// Signing in with Google through a web sheet (ASWebAuthenticationSession)
/// rather than Google's SDK: the authorization-code flow with PKCE, which is
/// what Google documents for native apps. Pure — the hash for the challenge
/// is computed by the caller (CryptoKit in the app), so this builds and runs
/// in Checks on any machine.
public enum GoogleOAuth {
  /// `com.googleusercontent.apps.123-abc` for `123-abc.apps.googleusercontent.com`:
  /// the redirect scheme Google gives every iOS client.
  public static func redirectScheme(clientID: String) -> String {
    let suffix = ".apps.googleusercontent.com"
    let id = clientID.hasSuffix(suffix) ? String(clientID.dropLast(suffix.count)) : clientID
    return "com.googleusercontent.apps.\(id)"
  }

  public static func redirectURI(clientID: String) -> String {
    "\(redirectScheme(clientID: clientID)):/oauthredirect"
  }

  public static func authorizationURL(clientID: String, codeChallenge: String, state: String) -> URL {
    var c = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
    c.queryItems = [
      .init(name: "client_id", value: clientID),
      .init(name: "redirect_uri", value: redirectURI(clientID: clientID)),
      .init(name: "response_type", value: "code"),
      .init(name: "scope", value: "openid email profile"),
      .init(name: "code_challenge", value: codeChallenge),
      .init(name: "code_challenge_method", value: "S256"),
      .init(name: "state", value: state),
      .init(name: "prompt", value: "select_account"),
    ]
    return c.url!
  }

  public enum CallbackResult: Equatable, Sendable {
    case code(String)
    /// The person closed the sheet or said no — not an error to show.
    case cancelled
    case failed
  }

  /// The redirect Google sent back, checked against the state we sent.
  public static func readCallback(_ url: URL, expectedState: String) -> CallbackResult {
    let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
    func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
    if value("error") == "access_denied" { return .cancelled }
    guard value("state") == expectedState, let code = value("code"), !code.isEmpty else {
      return .failed
    }
    return .code(code)
  }

  /// The form body that trades the code for tokens (no client secret: an iOS
  /// client has none, the PKCE verifier stands in for it).
  public static func tokenRequestBody(clientID: String, code: String, codeVerifier: String) -> Data {
    var c = URLComponents()
    c.queryItems = [
      .init(name: "client_id", value: clientID),
      .init(name: "code", value: code),
      .init(name: "code_verifier", value: codeVerifier),
      .init(name: "grant_type", value: "authorization_code"),
      .init(name: "redirect_uri", value: redirectURI(clientID: clientID)),
    ]
    // URLComponents leaves "+" alone, which a form body reads as a space.
    let query = (c.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B")
    return Data(query.utf8)
  }

  public struct TokenResponse: Decodable, Sendable {
    public let id_token: String?
  }

  /// Base64url without padding — the PKCE and JWT spelling.
  public static func base64URL(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
