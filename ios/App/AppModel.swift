import Foundation
import Observation
import TapWorshipKit

/// Who is signed in, and the one API client every screen shares.
///
/// A 401 from ANY request lands in `handle(_:)`, which signs out — the token
/// expired, was revoked by a secret rotation, or its account is gone, and in
/// every case the only way forward is the sign-in screen.
/// The two things an admin does from a phone, as one tab.
enum AdminSection: String, CaseIterable, Identifiable {
  case approvals = "Approvals"
  case team = "Team"
  var id: String { rawValue }
}

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
    self.api = APIClient(baseURL: baseURL, readOnly: AppConfig.readOnly, token: { store.load()?.token })
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
  /// After a name change on Profile, so Account shows it without signing in
  /// again (the token's name is only a hint; the server already has it).
  func renameSession(to name: String) {
    guard let current = session else { return }
    let updated = MobileSession(
      token: current.token,
      expiresAt: current.expiresAt,
      user: SessionUser(id: current.user.id, name: name, email: current.user.email, memberships: current.user.memberships)
    )
    store.save(updated)
    session = updated
  }

  @discardableResult
  func joinOrg(key: String) async throws -> ApiOrgRef {
    let org = try await api.joinOrg(key: key)
    guard let current = session else { return org }
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
    return org
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
    swapBadge = 0
    availabilityBadge = 0
    adminSection = .approvals
  }

  // MARK: Admin

  /// The orgs I administer, by name, from GET /api/me. nil until loaded; the
  /// token's own `isAdmin` hints decide the tabs until then, so they don't
  /// pop in a beat after launch.
  /// A read-only preview of production: screens hide what would write.
  var readOnly: Bool { api.readOnly }

  /// How many pushed screens are showing; tab swipes are off while any is.
  var tabSwipePauses = 0
  /// The tab bar's thin, icons-only look while the page scrolls down.
  var tabBarCompact = false
  /// Follows any list's scroll: down shrinks the bar, up or the top grows it.
  func scrolled(from old: CGFloat, to new: CGFloat) {
    let compact: Bool
    if new < 24 { compact = false }
    else if new - old > 4 { compact = true }
    else if old - new > 4 { compact = false }
    else { return }
    if compact != tabBarCompact { tabBarCompact = compact }
  }
  /// Where rows with their own swipe actions sit on screen, per tab. A tab
  /// swipe that starts inside one belongs to the row, not the tab bar.
  /// When a sideways tab swipe last moved. The finger lifting at the end of a
  /// swipe can land as a tap on whatever is under it on the new page (a day
  /// on the Unavailabilities grid opened its drawer); taps that soon after a
  /// swipe are ignored.
  @ObservationIgnored var tabSwipeAt: Date?
  var justSwiped: Bool { tabSwipeAt.map { Date().timeIntervalSince($0) < 0.6 } ?? false }
  @ObservationIgnored var sideSwipeZones: [String: (tab: AppTab, frame: CGRect)] = [:]
  /// Matched on height only: the frame is the row's content, but a list row
  /// (and its swipe) spans the screen's width. The padding covers the row's
  /// own insets above and below its content.
  /// Rows parked off to the side (Admin's other half) don't count.
  func ownsSideSwipe(at point: CGPoint, on tab: AppTab, width: CGFloat) -> Bool {
    sideSwipeZones.values.contains {
      $0.tab == tab && $0.frame.maxX > 0 && $0.frame.minX < width
        && point.y >= $0.frame.minY - 12 && point.y <= $0.frame.maxY + 12
    }
  }
  var tabSwipePaused: Bool { tabSwipePauses > 0 }

  private(set) var adminOrgs: [ApiMyOrg]?
  /// Which org the admin tabs are looking at. Shared, so switching on one
  /// tab switches the other — two tabs on two orgs would read as a bug.
  var adminOrgID: String?
  /// The Admin tab's badge.
  var pendingApprovals = 0
  /// My Sets' badge: open covers in a role I play + swap requests to me.
  var swapBadge = 0
  /// Availability's badge: requests I still owe an answer to.
  var availabilityBadge = 0
  /// Which half of the Admin tab is showing.
  var adminSection = AdminSection.approvals

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

  /// Every tab badge in one request (the web navbar's dots). Quiet on
  /// failure: a badge is a hint, and each tab shows its own errors.
  func refreshBadges() async {
    guard session != nil, let badges = try? await api.notifications(orgId: adminOrgID) else { return }
    swapBadge = badges.swapCount
    availabilityBadge = badges.availabilityOwed
    if adminOrgID != nil { pendingApprovals = badges.approvalCount }
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
