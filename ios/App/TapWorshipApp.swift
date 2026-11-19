import SwiftUI

@main
struct TapWorshipApp: App {
  @State private var model = AppModel()

  init() { TW.install() }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        // Figtree for every Text that doesn't pick its own style.
        .font(TW.body)
        // The brand teal, stated outright: touching UIKit's appearance
        // proxies at launch (TW.install) stops the asset-catalog accent from
        // reaching the window on its own.
        .tint(Color("AccentColor"))
        .modifier(ThemedWindow())
    }
  }
}

/// Signed out → sign-in. Signed in → the tabs. Nothing else decides which.
struct RootView: View {
  @Environment(AppModel.self) private var model
  /// The brand splash, once per launch, while the first screen loads under it.
  @State private var splash = true

  var body: some View {
    content
      .overlay {
        if splash {
          SplashView().transition(.opacity)
        }
      }
      .task {
        try? await Task.sleep(for: .milliseconds(1100))
        withAnimation(.smooth(duration: 0.4)) { splash = false }
      }
  }

  private var content: some View {
    Group {
      switch model.session {
      case nil:
        WelcomeView()
          .transition(.opacity)
      case let session? where session.user.hasNoOrg:
        JoinOrgView()
          .transition(.opacity)
      case _?:
        MainTabView()
          .transition(.opacity)
      }
    }
    .animation(.smooth, value: model.session?.user.memberships.count ?? -1)
  }
}

/// Five tabs at most, which is what a tab bar holds without a "More" list:
/// Calendar, My Sets, Availability, Account, and Admin for someone who is one
/// (Approvals and Team share it). The web's Create tab stays on the web:
/// generating a schedule is a big-screen job, and the web refuses its review
/// workspace at phone widths too.
struct MainTabView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.scenePhase) private var scenePhase
  // Opens on My Sets even though Calendar sits first in the bar.
  @State private var selection: AppTab = .mySets

  /// The tabs in bar order — the web navbar's order (Calendar, My Sets,
  /// Availability), Admin only for someone who is one.
  private var tabs: [AppTab] {
    model.isAdminAnywhere
      ? [.calendar, .mySets, .availability, .admin, .account]
      : [.calendar, .mySets, .availability, .account]
  }

  /// The finger's sideways pull during a tab swipe. A @GestureState, so it
  /// snaps back to 0 by itself when iOS cancels the drag (a row's own swipe
  /// action, a scroll taking over) — a plain @State never heard about the
  /// cancel and left the page stuck off-screen.
  /// Snaps back with its own animation, scoped to the pull alone (an
  /// `.animation` on the TabView also animated whatever the tab switch did).
  @GestureState(resetTransaction: Transaction(animation: .snappy)) private var pull: CGFloat = 0
  /// The slide-out / slide-in after a swipe commits.
  @State private var slideX: CGFloat = 0
  @State private var width: CGFloat = 400

  private var offsetX: CGFloat { pull + slideX }

  var body: some View {
    // The tabs live in a strip across the top, with the pages below it; the
    // bottom of the screen belongs to each page's action buttons.
    // iOS's own glass tab bar at the bottom.
    pages
    // The web's page color behind everything, the clock's strip included.
    .background(Color.twPage.ignoresSafeArea())
  }

  private var pages: some View {
    TabView(selection: $selection) {
      page(CalendarView(), .calendar)
        .tabItem { Label("Calendar", systemImage: "calendar") }
        .tag(AppTab.calendar)
      page(MySetsView(), .mySets)
        .tabItem { Label("My Sets", systemImage: "music.note.list") }
        .badge(model.swapBadge)
        .tag(AppTab.mySets)
      page(AvailabilityView(), .availability)
        .tabItem { Label("Unavailabilities", systemImage: "calendar.badge.clock") }
        .badge(model.availabilityBadge)
        .tag(AppTab.availability)
      if model.isAdminAnywhere {
        page(AdminView(), .admin)
          .tabItem { Label("Admin", systemImage: "checkmark.seal") }
          .badge(model.pendingApprovals)
          .tag(AppTab.admin)
      }
      page(AccountView(), .account)
        .tabItem { Label("Account", systemImage: "person.crop.circle") }
        .tag(AppTab.account)
    }
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    // Swipe left/right on a tab's main screen to move to the next/previous
    // tab, like the web's SwipePager. Off on pushed screens (a set's page,
    // Profile…), where a sideways drag belongs to rows and to Back.
    .simultaneousGesture(
      DragGesture(minimumDistance: 24, coordinateSpace: .global)
        .updating($pull) { value, pull, _ in
          guard !model.tabSwipePaused,
                !model.ownsSideSwipe(at: value.startLocation, on: selection, width: width),
                TabSwipe.isSideways(start: value.startLocation, translation: value.translation)
          else { return }
          model.tabSwipeAt = Date()
          // Resist at the ends, where there's nothing to go to.
          let dx = value.translation.width
          let step = dx < 0 ? 1 : -1
          pull = neighbour(step) == nil && adminStep(step) == nil ? dx * 0.25 : dx
        }
        .onEnded { value in
          guard !model.tabSwipePaused,
                !model.ownsSideSwipe(at: value.startLocation, on: selection, width: width),
                let step = TabSwipe.step(
                  start: value.startLocation,
                  translation: value.translation,
                  predicted: value.predictedEndTranslation
                )
          else { return }
          model.tabSwipeAt = Date()
          // Inside Admin, Approvals and Team come before the next tab.
          if let section = adminStep(step) {
            // Both halves are already laid out side by side: just glide
            // from wherever the finger left the page.
            withAnimation(.smooth(duration: 0.3)) { model.adminSection = section }
          } else if let next = neighbour(step) {
            slide(step: step) {
              selection = next
              // Arriving on Admin from the right lands on its right half.
              if next == .admin { model.adminSection = step > 0 ? .approvals : .team }
            }
          }
        }
    )
    .sensoryFeedback(.selection, trigger: selection)
    .task {
      await model.refreshAdminOrgs()
      await model.refreshBadges()
    }
    // Badges follow what you just did on a tab, and catch up on return.
    .onChange(of: selection) {
      // Belt and braces: whatever changed the tab, the page ends up in place.
      if slideX != 0 && abs(slideX) > width * 0.5 { slideX = 0 }
      Task { await model.refreshBadges() }
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { Task { await model.refreshBadges() } }
    }
  }

  /// One tab's content, moved by the swipe. Only the tab on screen moves:
  /// every page used to share the offset (and a fade), so a tab switched to
  /// mid-slide could appear already pushed aside and dimmed, which read as a
  /// black screen. Nothing fades now; the page only slides.
  private func page<V: View>(_ content: V, _ tab: AppTab) -> some View {
    // Admin moves only its list (its header stays put), so it gets the pull
    // to apply itself; every other page moves as a whole.
    content
      .background(Color.twPage)
      .offset(x: tab == selection && tab != .admin ? offsetX : 0)
      .environment(\.tabPull, tab == selection && tab == .admin ? offsetX : 0)
      .environment(\.appTab, tab)
  }

  private func neighbour(_ step: Int) -> AppTab? {
    guard let index = tabs.firstIndex(of: selection) else { return nil }
    let next = index + step
    return tabs.indices.contains(next) ? tabs[next] : nil
  }

  /// Switch tabs and let the new page glide in from the side the finger
  /// came from. The old version slid the old page out first and waited on an
  /// animation's completion to bring the new one in; when that completion
  /// didn't fire (a second swipe, a tab tap mid-slide) the page was left
  /// parked off-screen and the tab looked black. Now nothing waits: the new
  /// page is placed a little to the side and always animates to 0.
  private func slide(step: Int, change: () -> Void) {
    let entry: CGFloat = (step > 0 ? 1 : -1) * min(width * 0.35, 140)
    var still = Transaction()
    still.disablesAnimations = true
    withTransaction(still) {
      change()
      slideX = entry
    }
    withAnimation(.smooth(duration: 0.3)) { slideX = 0 }
  }

  /// The Admin half a swipe moves to before leaving the tab, if any.
  private func adminStep(_ step: Int) -> AdminSection? {
    guard selection == .admin else { return nil }
    switch (model.adminSection, step) {
    case (.approvals, 1): return .team
    case (.team, -1): return .approvals
    default: return nil
    }
  }
}

/// Marks a pushed screen: while it's showing, swiping sideways doesn't
/// switch tabs (it's for its rows, and for Back).
struct PausesTabSwipe: ViewModifier {
  @Environment(AppModel.self) private var model
  func body(content: Content) -> some View {
    content
      .onAppear { model.tabSwipePauses += 1 }
      .onDisappear { model.tabSwipePauses = max(0, model.tabSwipePauses - 1) }
  }
}

/// Marks a row whose own sideways swipe does something (swipe actions): a
/// drag that starts on it is the row's, and doesn't switch tabs. The row
/// reports where it is on screen; a gesture on the row itself never hears
/// the touch, since List hands it straight to the swipe actions.
struct OwnsSideSwipe: ViewModifier {
  @Environment(AppModel.self) private var model
  @Environment(\.appTab) private var tab
  let enabled: Bool
  @State private var id = UUID().uuidString

  func body(content: Content) -> some View {
    content
      .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame in
        guard enabled, let tab else { model.sideSwipeZones[id] = nil; return }
        model.sideSwipeZones[id] = (tab, frame)
      }
      .onDisappear { model.sideSwipeZones[id] = nil }
  }
}

extension EnvironmentValues {
  /// Which tab a view lives in (nil outside the tab bar, e.g. in a sheet).
  @Entry var appTab: AppTab? = nil
  /// The tab swipe's sideways pull, for a page that moves only part of itself.
  @Entry var tabPull: CGFloat = 0
}

extension View {
  func pausesTabSwipe() -> some View { modifier(PausesTabSwipe()) }
  /// `enabled: false` when the row has no swipe actions right now (read-only).
  func ownsSideSwipe(_ enabled: Bool = true) -> some View { modifier(OwnsSideSwipe(enabled: enabled)) }
}

enum AppTab: Hashable {
  case mySets, calendar, availability, admin, account
}

/// When a finished drag counts as "go to the next tab". Kept separate from
/// the view so the thresholds read in one place.
enum TabSwipe {
  /// Sideways must beat vertical by this much, so a scroll that drifts
  /// sideways stays a scroll (the web's AXIS_RATIO).
  static let axisRatio: CGFloat = 2
  /// A deliberate pull, or a shorter flick that would have carried this far.
  static let distance: CGFloat = 90
  static let flickDistance: CGFloat = 180
  /// Drags starting this close to the left edge belong to the system's
  /// back-swipe in a pushed screen.
  static let edgeGuard: CGFloat = 24

  /// Early in a drag: sideways enough, and not from the back-swipe edge.
  static func isSideways(start: CGPoint, translation: CGSize) -> Bool {
    start.x >= edgeGuard && abs(translation.width) > abs(translation.height) * axisRatio
  }

  /// +1 for the next tab (finger moved left), -1 for the previous, nil if
  /// the drag wasn't a tab swipe.
  static func step(start: CGPoint, translation: CGSize, predicted: CGSize) -> Int? {
    if start.x < edgeGuard { return nil }
    let dx = translation.width, dy = translation.height
    guard abs(dx) > abs(dy) * axisRatio else { return nil }
    guard abs(dx) >= distance || abs(predicted.width) >= flickDistance else { return nil }
    return dx < 0 ? 1 : -1
  }
}

#Preview("Tabs · member") {
  MainTabView()
    .environment(AppModel.fullPreview())
}

#Preview("Tabs · admin") {
  MainTabView()
    .environment(AppModel.adminPreview())
}

/// Light, dark, or whatever the phone is set to (the default), chosen on the
/// Account tab and remembered on this device. Mirrors the web's theme switch
/// (lib/theme.ts: light / dark / system).
enum AppTheme: String, CaseIterable, Identifiable {
  case system, light, dark
  static let storageKey = "appearance.theme"
  var id: String { rawValue }

  var title: String {
    switch self {
    case .system: "Device"
    case .light: "Light"
    case .dark: "Dark"
    }
  }

  /// nil = follow the device.
  var colorScheme: ColorScheme? {
    switch self {
    case .system: nil
    case .light: .light
    case .dark: .dark
    }
  }
}

/// Applies the chosen theme to the whole app, sheets included.
struct ThemedWindow: ViewModifier {
  @AppStorage(AppTheme.storageKey) private var theme = AppTheme.system
  func body(content: Content) -> some View {
    content
      .preferredColorScheme(theme.colorScheme)
      .animation(.smooth(duration: 0.3), value: theme)
  }
}
