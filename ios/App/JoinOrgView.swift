import SwiftUI
import TapWorshipKit

/// A signed-in account that's in no org yet — a new Apple or Google sign-up.
/// The web's /join: enter the key your team's admin gave you.
struct JoinOrgView: View {
  @Environment(AppModel.self) private var model
  @State private var key = ""
  @State private var joining = false
  @State private var errorMessage: String?
  @State private var errorTick = 0
  @FocusState private var focused: Bool

  private var canJoin: Bool { !key.trimmingCharacters(in: .whitespaces).isEmpty && !joining }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          VStack(alignment: .leading, spacing: 6) {
            Text("Join your team")
              .font(.title2.bold())
            Text("Ask your worship team's admin for your organization's key, then enter it here.")
              .font(.subheadline)
              .foregroundStyle(.secondary)
          }
          .padding(.vertical, 4)
          .listRowBackground(Color.clear)
        }
        Section {
          TextField("Organization key", text: $key)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.join)
            .focused($focused)
            .onSubmit(join)
        } footer: {
          if let errorMessage {
            Label(errorMessage, systemImage: "exclamationmark.circle")
              .foregroundStyle(.red)
              .transition(.opacity)
          }
        }
        Section {
          Button(action: join) {
            ZStack {
              Text("Join").bold().opacity(joining ? 0 : 1)
              if joining { ProgressView().accessibilityLabel("Joining") }
            }
            .frame(maxWidth: .infinity, minHeight: 44)
          }
          .disabled(!canJoin)
        }
      }
      .navigationTitle("Welcome")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Sign out") { model.signOut() }
        }
      }
      .animation(.default, value: errorMessage)
      .sensoryFeedback(.error, trigger: errorTick)
      .onAppear { focused = true }
    }
  }

  private func join() {
    guard canJoin else { return }
    joining = true
    errorMessage = nil
    Task {
      defer { joining = false }
      do {
        try await model.joinOrg(key: key.trimmingCharacters(in: .whitespaces))
      } catch {
        if let message = model.handle(error) {
          errorMessage = message
          errorTick += 1
        }
      }
    }
  }
}

#Preview("Join an org") {
  JoinOrgView()
    .environment(AppModel.preview(signedIn: true))
}
