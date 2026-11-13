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

  /// Google or Apple. A `nameConflicts` error comes back to the caller, which
  /// asks the person and may call again with `allowDuplicateName`.
  func socialSignIn(
    _ provider: SocialProvider,
    idToken: String,
    name: String? = nil,
    allowDuplicateName: Bool = false
  ) async throws {
    let session = try await api.socialSignIn(
      provider: provider, idToken: idToken, name: name, allowDuplicateName: allowDuplicateName
    )
    store.save(session)
    self.session = session
  }

  /// Redeem an org key. The token's memberships are only hints, so the new
  /// one is added to the saved session here rather than minting a new token.
  func joinOrg(key: String) async throws {
    let org = try await api.joinOrg(key: key)
    guard let current = session else { return }
    var memberships = current.user.memberships
    if !memberships.contains(where: { $0.orgId == org.id }) {
      memberships.append(SessionMembership(orgId: org.id, isAdmin: false))
    }
    let updated = MobileSession(
      token: current.token,
      expiresAt: current.expiresAt,
      user: SessionUser(id: current.user.id, name: current.user.name, email: current.user.email, memberships: memberships)
    )
    store.save(updated)
    session = updated
  }

  /// Gone for good. Signs out only once the server has said yes.
  func deleteAccount(confirm: String) async throws {
    try await api.deleteAccount(confirm: confirm)
    signOut()
  }

  func signOut() {
    store.clear()
    session = nil
    adminOrgs = nil
    adminOrgID = nil
    pendingApprovals = 0
  }

  // MARK: Admin

  /// The orgs I administer, by name, from GET /api/me. nil until loaded; the
  /// token's own `isAdmin` hints decide the tabs until then, so they don't
  /// pop in a beat after launch.
  private(set) var adminOrgs: [ApiMyOrg]?
  /// Which org the admin tabs are looking at. Shared, so switching on one
  /// tab switches the other — two tabs on two orgs would read as a bug.
  var adminOrgID: String?
  /// The Approvals tab's badge.
  var pendingApprovals = 0

  var isAdminAnywhere: Bool {
    if let adminOrgs { return !adminOrgs.isEmpty }
    return session?.user.memberships.contains(where: \.isAdmin) ?? false
  }

  var adminOrg: ApiMyOrg? { adminOrgs?.first { $0.orgId == adminOrgID } }

  /// The org an admin screen should load, fetching the list first if this
  /// is the first admin screen to ask.
  func currentAdminOrgID() async -> String? {
    if adminOrgs == nil { await refreshAdminOrgs() }
    return adminOrgID
  }

  /// Refreshes the org list. A failure keeps what we had: the admin tabs
  /// show their own errors when their own loads fail.
  func refreshAdminOrgs() async {
    do {
      let orgs = try await api.me().adminOrgs
      adminOrgs = orgs
      if !orgs.contains(where: { $0.orgId == adminOrgID }) { adminOrgID = orgs.first?.orgId }
      // The tab's badge, before anyone opens the tab.
      if let orgId = adminOrgID {
        pendingApprovals = (try? await api.approvals(orgId: orgId).count) ?? pendingApprovals
      }
    } catch {
      _ = handle(error)
    }
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
