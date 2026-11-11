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

struct MainTabView: View {
  var body: some View {
    TabView {
      MySetsView()
        .tabItem { Label("My Sets", systemImage: "music.note.list") }
      AccountView()
        .tabItem { Label("Account", systemImage: "person.crop.circle") }
    }
  }
}
