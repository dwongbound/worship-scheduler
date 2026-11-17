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

  var body: some View {
    TabView {
      MySetsView()
        .tabItem { Label("My Sets", systemImage: "music.note.list") }
      CalendarView()
        .tabItem { Label("Calendar", systemImage: "calendar") }
      AvailabilityView()
        .tabItem { Label("Availability", systemImage: "calendar.badge.clock") }
      if model.isAdminAnywhere {
        AdminView()
          .tabItem { Label("Admin", systemImage: "checkmark.seal") }
          .badge(model.pendingApprovals)
      }
      AccountView()
        .tabItem { Label("Account", systemImage: "person.crop.circle") }
    }
    .task { await model.refreshAdminOrgs() }
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
