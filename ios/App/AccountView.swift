import SwiftUI
import TapWorshipKit

/// Who's signed in, and the way out. Everything else about an account still
/// lives on the web's /profile for now — linked rather than half-copied.
struct AccountView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.openURL) private var openURL
  @State private var confirmSignOut = false
  @State private var deleting = false
  @State private var joining = false
  @State private var joinedName: String?

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
            Label("Edit profile on the web", systemImage: "safari")
          }
        } footer: {
          Text("Calendar invites, Slack and your password are managed on the web for now.")
        }
        Section {
          Button {
            joining = true
          } label: {
            Label("Join another org", systemImage: "person.badge.key")
          }
        } footer: {
          if let joinedName {
            Text("You've joined \(joinedName).")
          } else {
            Text("Got a key from another church or ministry? Enter it to join their team too.")
          }
        }
        if AppConfig.isDevServer {
          Section {
            LabeledContent("Server", value: AppConfig.baseURL.absoluteString)
          } footer: {
            Text("This is a development build. It isn't talking to tapworship.com.")
          }
        }
        // Plain List rows: a List row is already at least 44pt, so an extra
        // minHeight frame here only made these two rows taller than the rest.
        Section {
          Button("Sign out", role: .destructive) { confirmSignOut = true }
            // On the button, so the dialog points at it rather than the list.
            .confirmationDialog("Sign out of TapWorship?", isPresented: $confirmSignOut, titleVisibility: .visible) {
              Button("Sign out", role: .destructive) { model.signOut() }
            }
        }
        Section {
          Button("Delete account", role: .destructive) { deleting = true }
        } footer: {
          Text("Permanently deletes your account and everything on it.")
        }
      }
      .listStyle(.insetGrouped)
      .navigationTitle("Account")
      .sheet(isPresented: $deleting) {
        DeleteAccountView()
      }
      .sheet(isPresented: $joining) {
        JoinAnotherOrgSheet { joinedName = $0 }
      }
    }
  }
}

/// Account → Join another org: the web's /orgs "Add an org…" for someone
/// who's already in one.
struct JoinAnotherOrgSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let joined: (String) -> Void

  @State private var key = ""
  @State private var working = false
  @State private var errorMessage: String?
  @State private var errorTick = 0
  @FocusState private var focused: Bool

  private var trimmed: String { key.trimmingCharacters(in: .whitespaces) }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Organization key", text: $key)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.join)
            .focused($focused)
            .onSubmit { Task { await join() } }
        } footer: {
          if let errorMessage {
            Label(errorMessage, systemImage: "exclamationmark.circle")
              .foregroundStyle(.red)
          } else {
            Text("Ask that team's admin for their organization's key.")
          }
        }
      }
      .navigationTitle("Join another org")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }.disabled(working)
        }
        ToolbarItem(placement: .confirmationAction) {
          if working {
            ProgressView()
          } else {
            Button("Join") { Task { await join() } }.disabled(trimmed.isEmpty)
          }
        }
      }
      .sensoryFeedback(.error, trigger: errorTick)
      .onAppear { focused = true }
    }
    .presentationDetents([.medium])
  }

  private func join() async {
    guard !trimmed.isEmpty, !working else { return }
    working = true
    errorMessage = nil
    do {
      let org = try await model.joinOrg(key: trimmed)
      await model.refreshAdminOrgs()
      joined(org.name)
      dismiss()
    } catch {
      if let message = model.handle(error) {
        errorMessage = message
        errorTick += 1
      }
    }
    working = false
  }
}

#Preview("Account") {
  AccountView()
    .environment(AppModel.preview(signedIn: true))
}

/// The one way to delete an account in the app, and deliberately hard to do
/// by accident: it says plainly that it can't be undone, lists what goes, and
/// the button stays off until DELETE is typed. The server checks the same
/// phrase (lib/accountDeletion.ts), and refuses while you're an org's only admin.
struct DeleteAccountView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var typed = ""
  @State private var working = false
  @State private var errorMessage: String?
  @State private var errorTick = 0
  @FocusState private var focused: Bool

  private var armed: Bool { AccountDeletion.matches(typed) && !working }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          VStack(alignment: .leading, spacing: 10) {
            Label {
              Text("This can't be undone.")
                .font(.title3.bold())
            } icon: {
              Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
            }
            Text("There's no way to get your account back, and no one, admins included, can restore it.")
              .font(.subheadline)
          }
          .padding(.vertical, 4)
        }

        Section("Deleting your account removes, for good") {
          bullet("person.crop.circle.badge.xmark", "Your sign-in and profile")
          bullet("person.3", "Your place in every org and team")
          bullet("music.note.list", "Every set you're on, upcoming and past. Your seats on upcoming sets open up.")
          bullet("calendar.badge.minus", "Your availability, cover requests and swaps")
          bullet("calendar", "Any Google Calendar you connected for an org, which gets disconnected")
        }

        Section {
          TextField("Type \(AccountDeletion.phrase) to confirm", text: $typed)
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
            .focused($focused)
            .disabled(working)
        } header: {
          Text("Type \(AccountDeletion.phrase) to confirm")
        } footer: {
          if let errorMessage {
            Label(errorMessage, systemImage: "exclamationmark.circle")
              .foregroundStyle(.red)
              .transition(.opacity)
          }
        }

        Section {
          Button(role: .destructive, action: deleteAccount) {
            ZStack {
              Text("Delete My Account Forever").bold().opacity(working ? 0 : 1)
              if working { ProgressView().accessibilityLabel("Deleting your account") }
            }
            .frame(maxWidth: .infinity, minHeight: 44)
          }
          .disabled(!armed)
        }
      }
      .navigationTitle("Delete account")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }
            .disabled(working)
        }
      }
      .animation(.default, value: errorMessage)
      .sensoryFeedback(.error, trigger: errorTick)
      .interactiveDismissDisabled(working)
    }
  }

  private func bullet(_ symbol: String, _ text: String) -> some View {
    Label(text, systemImage: symbol)
      .font(.subheadline)
  }

  private func deleteAccount() {
    guard armed else { return }
    working = true
    errorMessage = nil
    focused = false
    Task {
      do {
        // On success the session ends and the whole app goes back to sign-in,
        // taking this sheet with it.
        try await model.deleteAccount(confirm: typed.trimmingCharacters(in: .whitespaces))
      } catch {
        working = false
        if let message = model.handle(error) {
          errorMessage = message
          errorTick += 1
        }
      }
    }
  }
}

#Preview("Delete account") {
  DeleteAccountView()
    .environment(AppModel.preview(signedIn: true))
}

#Preview("Delete account · dark, largest text") {
  DeleteAccountView()
    .environment(AppModel.preview(signedIn: true))
    .preferredColorScheme(.dark)
    .dynamicTypeSize(.accessibility5)
}
