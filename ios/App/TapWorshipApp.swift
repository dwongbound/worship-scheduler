import SwiftUI

@main
struct TapWorshipApp: App {
  @State private var model = AppModel()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
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
        SignInView()
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
/// My Sets, Calendar, Availability, Account, and Admin for someone who is one
/// (Approvals and Team share it). The web's Create tab stays on the web:
/// generating a schedule is a big-screen job, and the web refuses its review
/// workspace at phone widths too.
struct MainTabView: View {
  @Environment(AppModel.self) private var model
  @State private var selection: AppTab = .mySets

  /// The tabs in bar order, Admin only for someone who is one.
  private var tabs: [AppTab] {
    model.isAdminAnywhere
      ? [.mySets, .calendar, .availability, .admin, .account]
      : [.mySets, .calendar, .availability, .account]
  }

  var body: some View {
    TabView(selection: $selection) {
      MySetsView()
        .tabItem { Label("My Sets", systemImage: "music.note.list") }
        .tag(AppTab.mySets)
      CalendarView()
        .tabItem { Label("Calendar", systemImage: "calendar") }
        .tag(AppTab.calendar)
      AvailabilityView()
        .tabItem { Label("Availability", systemImage: "calendar.badge.clock") }
        .tag(AppTab.availability)
      if model.isAdminAnywhere {
        AdminView()
          .tabItem { Label("Admin", systemImage: "checkmark.seal") }
          .badge(model.pendingApprovals)
          .tag(AppTab.admin)
      }
      AccountView()
        .tabItem { Label("Account", systemImage: "person.crop.circle") }
        .tag(AppTab.account)
    }
    // Swipe left/right anywhere on a tab to move to the next/previous one,
    // like the web's SwipePager. Simultaneous, so scrolling and row swipe
    // actions keep working; TabSwipe decides whether a drag was a tab swipe.
    .simultaneousGesture(
      DragGesture(minimumDistance: 24)
        .onEnded { value in
          guard let step = TabSwipe.step(
            start: value.startLocation,
            translation: value.translation,
            predicted: value.predictedEndTranslation
          ) else { return }
          move(by: step)
        }
    )
    .sensoryFeedback(.selection, trigger: selection)
    .task { await model.refreshAdminOrgs() }
  }

  private func move(by step: Int) {
    guard let index = tabs.firstIndex(of: selection) else { return }
    let next = index + step
    guard tabs.indices.contains(next) else { return }
    withAnimation(.smooth) { selection = tabs[next] }
  }
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
