import SwiftUI

@main
struct TapWorshipApp: App {
  @State private var model = AppModel()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        .modifier(ThemedWindow())
    }
  }
}

/// Signed out → sign-in. Signed in → the tabs. Nothing else decides which.
struct RootView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
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
    TabView(selection: $selection) {
      page(CalendarView(), .calendar)
        .tabItem { Label("Calendar", systemImage: "calendar") }
        .tag(AppTab.calendar)
      page(MySetsView(), .mySets)
        .tabItem { Label("My Sets", systemImage: "music.note.list") }
        .badge(model.swapBadge)
        .tag(AppTab.mySets)
      page(AvailabilityView(), .availability)
        .tabItem { Label("Availability", systemImage: "calendar.badge.clock") }
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
      DragGesture(minimumDistance: 24)
        .updating($pull) { value, pull, _ in
          guard !model.tabSwipePaused,
                TabSwipe.isSideways(start: value.startLocation, translation: value.translation)
          else { return }
          // Resist at the ends, where there's no tab to go to.
          let dx = value.translation.width
          pull = neighbour(dx < 0 ? 1 : -1) == nil ? dx * 0.25 : dx
        }
        .onEnded { value in
          guard !model.tabSwipePaused,
                let step = TabSwipe.step(
                  start: value.startLocation,
                  translation: value.translation,
                  predicted: value.predictedEndTranslation
                ),
                let next = neighbour(step)
          else { return }
          slide(to: next, step: step, from: value.translation.width)
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
    content
      .offset(x: tab == selection ? offsetX : 0)
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
  private func slide(to next: AppTab, step: Int, from released: CGFloat) {
    let entry: CGFloat = (step > 0 ? 1 : -1) * min(width * 0.35, 140)
    var still = Transaction()
    still.disablesAnimations = true
    withTransaction(still) {
      selection = next
      slideX = entry
    }
    withAnimation(.smooth(duration: 0.3)) { slideX = 0 }
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

extension View {
  func pausesTabSwipe() -> some View { modifier(PausesTabSwipe()) }
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
