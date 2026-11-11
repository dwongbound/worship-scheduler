import Foundation
import Observation
import TapWorshipKit

/// Who is signed in, and the one API client every screen shares.
///
/// A 401 from ANY request lands in `handle(_:)`, which signs out — the token
/// expired, was revoked by a secret rotation, or its account is gone, and in
/// every case the only way forward is the sign-in screen.
@MainActor
@Observable
final class AppModel {
  private(set) var session: MobileSession?
  private let store: SessionStore
  let api: APIClient

  init(store: SessionStore = SessionStore(), baseURL: URL = AppConfig.baseURL) {
    self.store = store
    let saved = store.load()
    let live = saved.flatMap { $0.isExpired() ? nil : $0 }
    if saved != nil && live == nil { store.clear() }
    self.session = live
    // The client reads the token through the store rather than capturing it,
    // so signing in or out never needs a new client.
    self.api = APIClient(baseURL: baseURL, token: { store.load()?.token })
  }

  /// For previews: a model that is already signed in and never touches the
  /// Keychain's real entry.
  init(previewSession: MobileSession?, api: APIClient) {
    self.store = SessionStore()
    self.session = previewSession
    self.api = api
  }

  func signIn(username: String, password: String) async throws {
    let session = try await api.signIn(username: username, password: password)
    store.save(session)
    self.session = session
  }

  func signOut() {
    store.clear()
    session = nil
  }

  /// Every screen routes its errors through here. Returns the words to show,
  /// or nil when the error was a sign-out (the screen is about to go away).
  func handle(_ error: Error) -> String? {
    let apiError = (error as? APIError) ?? .network(error.localizedDescription)
    if apiError == .unauthorized {
      signOut()
      return nil
    }
    return apiError.message
  }
}
