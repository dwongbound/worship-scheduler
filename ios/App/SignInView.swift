import SwiftUI
import TapWorshipKit

/// Username-or-email + password, the same two fields as the web's /login.
///
/// No sign-up and no Google button: there's no self-serve sign-up on the web
/// either (an admin adds people), and Google sign-in on iOS would also oblige
/// Sign in with Apple under App Store rule 4.8. Accounts made with Google have
/// no password, so their footer line points them at setting one on the web.
struct SignInView: View {
  @Environment(AppModel.self) private var model

  @State private var username = ""
  @State private var password = ""
  @State private var isSigningIn = false
  @State private var errorMessage: String?
  @FocusState private var focus: Field?

  private enum Field { case username, password }

  private var canSubmit: Bool {
    !username.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty && !isSigningIn
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          VStack(spacing: 8) {
            Image("SignInMark")
              .resizable()
              .scaledToFit()
              .frame(width: 72, height: 72)
              .accessibilityHidden(true)
            Text("TapWorship")
              .font(.title.bold())
            Text("Your sets, your swaps, your team.")
              .font(.subheadline)
              .foregroundStyle(.secondary)
          }
          .frame(maxWidth: .infinity)
          .padding(.vertical, 8)
          .listRowBackground(Color.clear)
        }

        Section {
          TextField("Username or email", text: $username)
            .textContentType(.username)
            .keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.next)
            .focused($focus, equals: .username)
            .onSubmit { focus = .password }
          SecureField("Password", text: $password)
            .textContentType(.password)
            .submitLabel(.go)
            .focused($focus, equals: .password)
            .onSubmit(submit)
        } footer: {
          if let errorMessage {
            Label(errorMessage, systemImage: "exclamationmark.circle")
              .foregroundStyle(.red)
              .font(.footnote)
          }
        }

        Section {
          Button(action: submit) {
            HStack {
              Spacer()
              if isSigningIn {
                ProgressView()
                  .accessibilityLabel("Signing in")
              } else {
                Text("Sign in").bold()
              }
              Spacer()
            }
            .frame(minHeight: 44)
          }
          .disabled(!canSubmit)
        } footer: {
          Text("No account yet? Your team's admin adds you. Signed up with Google? Set a password on tapworship.com under Profile, then sign in here.")
        }
      }
      .navigationTitle("Sign in")
      .navigationBarTitleDisplayMode(.inline)
      .disabled(isSigningIn)
      .onAppear { if username.isEmpty { focus = .username } }
    }
  }

  private func submit() {
    guard canSubmit else { return }
    focus = nil
    errorMessage = nil
    isSigningIn = true
    Task {
      defer { isSigningIn = false }
      do {
        try await model.signIn(username: username.trimmingCharacters(in: .whitespaces), password: password)
      } catch {
        password = ""
        errorMessage = (error as? APIError)?.message ?? APIError.network("").message
        focus = .password
      }
    }
  }
}

#Preview("Sign in") {
  SignInView()
    .environment(AppModel.preview(signedIn: false))
}

#Preview("Sign in · SE, dark, largest text") {
  SignInView()
    .environment(AppModel.preview(signedIn: false))
    .preferredColorScheme(.dark)
    .dynamicTypeSize(.accessibility5)
}
