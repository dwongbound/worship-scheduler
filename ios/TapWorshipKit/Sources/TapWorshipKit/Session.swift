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

// MARK: Sign up

/// POST /api/signup — a new account with a password (the web's "Sign up").
/// The email doubles as the username. `orgKey` also lets the server hand over
/// an account an admin already made for this email.
public struct SignUpForm: Encodable, Equatable, Sendable {
  public var firstName: String
  public var lastName: String
  public var email: String
  public var password: String
  public var orgKey: String
  public var allowDuplicateName = false

  public init(firstName: String, lastName: String, email: String, password: String, orgKey: String) {
    self.firstName = firstName
    self.lastName = lastName
    self.email = email
    self.password = password
    self.orgKey = orgKey
  }

  /// Trimmed, the email lowercased, as the server stores them.
  public var cleaned: SignUpForm {
    var copy = self
    copy.firstName = firstName.trimmingCharacters(in: .whitespacesAndNewlines)
    copy.lastName = lastName.trimmingCharacters(in: .whitespacesAndNewlines)
    copy.email = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    copy.orgKey = orgKey.trimmingCharacters(in: .whitespacesAndNewlines)
    return copy
  }

  /// Why the form can't be sent yet, or nil. The app asks for the org key up
  /// front: an account with no org can't see anything.
  public func problem(confirm: String) -> String? {
    let f = cleaned
    if f.firstName.isEmpty || f.lastName.isEmpty { return "Enter your first and last name." }
    if !SignUpForm.looksLikeEmail(f.email) { return "Enter a valid email." }
    if let p = ProfileRules.passwordProblem(password, confirm: confirm) { return p }
    if f.orgKey.isEmpty { return "Enter your organization's key. Your team's admin has it." }
    return nil
  }

  /// The server's own check (lib: EMAIL_RE): something@something.something.
  public static func looksLikeEmail(_ s: String) -> Bool {
    let parts = s.split(separator: "@", omittingEmptySubsequences: false)
    guard parts.count == 2, !parts[0].isEmpty, !s.contains(" ") else { return false }
    let domain = parts[1].split(separator: ".", omittingEmptySubsequences: false)
    return domain.count >= 2 && domain.allSatisfy { !$0.isEmpty }
  }
}

/// What /api/signup answered: a new account, or an existing one claimed.
public struct SignUpResult: Decodable, Equatable, Sendable {
  public let ok: Bool
  /// True when the key handed over an account an admin had already made, which
  /// is already in that org.
  public let claimed: Bool?
}

extension APIClient {
  public func signUp(_ form: SignUpForm) async throws -> SignUpResult {
    try await send("POST", "/api/signup", body: form.cleaned, authorized: false)
  }
}
