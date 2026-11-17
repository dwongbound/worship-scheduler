import AuthenticationServices
import CryptoKit
import Foundation
import TapWorshipKit

/// Google sign-in without Google's SDK: the system's web sign-in sheet
/// (`WebAuthenticationSession`) running Google's authorization-code flow with
/// PKCE, then the code traded for an ID token the server verifies. The URL
/// and form rules live in TapWorshipKit (`GoogleOAuth`) and are checked there.
enum GoogleSignIn {
  enum Outcome {
    case idToken(String)
    case cancelled
  }

  enum Failure: Error { case notConfigured, failed }

  @MainActor
  static func run(using session: WebAuthenticationSession, clientID: String) async throws -> Outcome {
    let verifier = randomURLSafe(byteCount: 32)
    let challenge = GoogleOAuth.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    let state = randomURLSafe(byteCount: 16)
    let url = GoogleOAuth.authorizationURL(clientID: clientID, codeChallenge: challenge, state: state)

    let callback: URL
    do {
      callback = try await session.authenticate(
        using: url,
        callbackURLScheme: GoogleOAuth.redirectScheme(clientID: clientID),
        // No cookie left behind in Safari: signing out of the app and in as
        // someone else on a shared iPad shouldn't silently reuse the last account.
        preferredBrowserSession: .ephemeral
      )
    } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
      return .cancelled
    }

    switch GoogleOAuth.readCallback(callback, expectedState: state) {
    case .cancelled: return .cancelled
    case .failed: throw Failure.failed
    case .code(let code):
      var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
      request.httpMethod = "POST"
      request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
      request.httpBody = GoogleOAuth.tokenRequestBody(clientID: clientID, code: code, codeVerifier: verifier)
      let (data, response) = try await URLSession.shared.data(for: request)
      guard (response as? HTTPURLResponse)?.statusCode == 200,
            let idToken = try? JSONDecoder().decode(GoogleOAuth.TokenResponse.self, from: data).id_token
      else { throw Failure.failed }
      return .idToken(idToken)
    }
  }

  private static func randomURLSafe(byteCount: Int) -> String {
    var bytes = [UInt8](repeating: 0, count: byteCount)
    _ = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
    return GoogleOAuth.base64URL(Data(bytes))
  }
}
