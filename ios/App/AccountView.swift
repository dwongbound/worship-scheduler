import SwiftUI
import TapWorshipKit

/// Who's signed in, and the way out. Everything else about an account still
/// lives on the web's /profile for now — linked rather than half-copied.
struct AccountView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.openURL) private var openURL
  @State private var confirmSignOut = false

  var body: some View {
    NavigationStack {
      List {
        if let user = model.session?.user {
          Section {
            LabeledContent("Name", value: user.name ?? "—")
            if let email = user.email { LabeledContent("Email", value: email) }
          }
        }
        Section {
          Button {
            openURL(AppConfig.baseURL.appending(path: "profile"))
          } label: {
            Label("Edit profile on tapworship.com", systemImage: "safari")
          }
        } footer: {
          Text("Availability, calendar invites, Slack and your password are managed on the web for now.")
        }
        Section {
          Button("Sign out", role: .destructive) { confirmSignOut = true }
            .frame(minHeight: 44)
        }
      }
      .listStyle(.insetGrouped)
      .navigationTitle("Account")
      .confirmationDialog("Sign out of TapWorship?", isPresented: $confirmSignOut, titleVisibility: .visible) {
        Button("Sign out", role: .destructive) { model.signOut() }
      }
    }
  }
}

#Preview("Account") {
  AccountView()
    .environment(AppModel.preview(signedIn: true))
}
