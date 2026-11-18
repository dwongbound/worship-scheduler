import AuthenticationServices
import SwiftUI
import TapWorshipKit

/// The way in: username-or-email + password (the web's /login), Sign in with
/// Apple, and Google. Apple and Google can also CREATE an account, as the
/// web's Google sign-in does; a brand-new account then lands on JoinOrgView.
///
/// Apple sits first among the two buttons and is the same size as Google's,
/// which is what App Store rule 4.8 asks of an app offering both.
struct SignInView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.webAuthenticationSession) private var webAuthSession
  @Environment(\.colorScheme) private var colorScheme

  @State private var username = ""
  @State private var password = ""
  @State private var busy: Busy?
  @State private var errorMessage: String?
  @State private var errorTick = 0
  @State private var conflict: PendingConflict?
  @FocusState private var focus: Field?

  private enum Field { case username, password }
  private enum Busy { case password, apple, google }

  /// A social sign-in waiting on "is that you?" — kept so "Not me" can retry
  /// with the same token instead of sending the person through the sheet again.
  private struct PendingConflict: Identifiable {
    let id = UUID()
    let provider: SocialProvider
    let idToken: String
    let name: String?
    let accounts: [ExistingAccount]
  }

  private var canSubmit: Bool {
    !username.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty && busy == nil
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          header
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
            .onSubmit(submitPassword)
        } footer: {
          if let errorMessage {
            Label(errorMessage, systemImage: "exclamationmark.circle")
              .foregroundStyle(.red)
              .font(.footnote)
              .transition(.opacity)
          }
        }

        Section {
          Button(action: submitPassword) {
            ZStack {
              // The label keeps its space while the spinner shows, so the
              // button never changes size mid-press.
              Text("Sign in").bold().opacity(busy == .password ? 0 : 1)
              if busy == .password {
                ProgressView().accessibilityLabel("Signing in")
              }
            }
          }
          .buttonStyle(SignInButtonStyle(kind: .primary))
          .listRowInsets(EdgeInsets())
          .listRowBackground(Color.clear)
          .disabled(!canSubmit)
        }

        // "or" between the password form and the two sign-in providers.
        Section {
          HStack(spacing: 12) {
            VStack { Divider() }
            Text("or")
              .font(.subheadline)
              .foregroundStyle(.secondary)
            VStack { Divider() }
          }
          .accessibilityHidden(true)
          .listRowInsets(EdgeInsets())
          .listRowBackground(Color.clear)
        }

        Section {
          // One row, so the two provider buttons sit the same 12pt apart as
          // everything else on this screen (list rows with zero insets touch).
          VStack(spacing: 12) {
            SignInWithAppleButton(.signIn) { request in
              request.requestedScopes = [.fullName, .email]
            } onCompletion: { result in
              handleApple(result)
            }
            .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
            .frame(height: SignInButtonStyle.height)
            .clipShape(Capsule())
            .disabled(busy != nil)
            .opacity(busy == .apple ? 0.5 : 1)

            if let clientID = AppConfig.googleIOSClientID {
              Button {
                runGoogle(clientID: clientID)
              } label: {
                HStack(spacing: 10) {
                  if busy == .google {
                    ProgressView()
                  } else {
                    // Google's own "G", as its branding guidelines require.
                    Image("GoogleG")
                      .resizable()
                      .frame(width: 18, height: 18)
                      .accessibilityHidden(true)
                  }
                  Text("Sign in with Google")
                }
              }
              .buttonStyle(SignInButtonStyle(kind: .google))
              .disabled(busy != nil)
            }
          }
          .listRowInsets(EdgeInsets())
        } footer: {
          Text("New to TapWorship? Signing in with Apple or Google creates your account. Then enter your team's org key.")
        }
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .listSectionSpacing(12)
      }
      .navigationTitle("Sign in")
      .navigationBarTitleDisplayMode(.inline)
      .animation(.default, value: errorMessage)
      .sensoryFeedback(.error, trigger: errorTick)
      .onAppear { if username.isEmpty { focus = .username } }
      .alert(
        "Is this you?",
        isPresented: Binding(get: { conflict != nil }, set: { if !$0 { conflict = nil } }),
        presenting: conflict
      ) { pending in
        Button("It's me, I'll sign in with that account") { conflict = nil }
        Button("Not me, create my account") {
          conflict = nil
          Task { await finishSocial(pending.provider, pending.idToken, name: pending.name, allowDuplicateName: true) }
        }
      } message: { pending in
        let first = pending.accounts.first
        Text("Someone named \(first?.name ?? "this") already has an account (\(first?.email ?? "another address")). If that's you, sign in with it instead so your sets stay in one place.")
      }
    }
  }

  private var header: some View {
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
      if AppConfig.isDevServer {
        // A dev build must never pass for the real thing.
        Text("Development build · \(AppConfig.baseURL.host ?? "dev server")")
          .font(.footnote.weight(.medium))
          .foregroundStyle(.orange)
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 8)
  }

  // MARK: Actions

  private func submitPassword() {
    guard canSubmit else { return }
    focus = nil
    errorMessage = nil
    busy = .password
    Task {
      defer { busy = nil }
      do {
        try await model.signIn(username: username.trimmingCharacters(in: .whitespaces), password: password)
      } catch {
        password = ""
        show(error)
        focus = .password
      }
    }
  }

  private func handleApple(_ result: Result<ASAuthorization, Error>) {
    switch result {
    case .failure(let error):
      // Closing the Apple sheet is a choice, not an error.
      if (error as? ASAuthorizationError)?.code == .canceled { return }
      show(error)
    case .success(let authorization):
      guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
            let data = credential.identityToken,
            let idToken = String(data: data, encoding: .utf8)
      else {
        show(APIError.network("No identity token"))
        return
      }
      // Apple shares the name only on the very first sign-in, so pass it on.
      let name = credential.fullName.flatMap {
        PersonNameComponentsFormatter.localizedString(from: $0, style: .default)
      }.flatMap { $0.isEmpty ? nil : $0 }
      busy = .apple
      Task {
        await finishSocial(.apple, idToken, name: name)
        busy = nil
      }
    }
  }

  private func runGoogle(clientID: String) {
    errorMessage = nil
    busy = .google
    Task {
      defer { busy = nil }
      do {
        switch try await GoogleSignIn.run(using: webAuthSession, clientID: clientID) {
        case .cancelled: return
        case .idToken(let idToken): await finishSocial(.google, idToken, name: nil)
        }
      } catch {
        show(APIError.server(status: 0, message: "Google sign-in didn't finish. Try again."))
      }
    }
  }

  private func finishSocial(_ provider: SocialProvider, _ idToken: String, name: String?, allowDuplicateName: Bool = false) async {
    errorMessage = nil
    do {
      try await model.socialSignIn(provider, idToken: idToken, name: name, allowDuplicateName: allowDuplicateName)
    } catch APIError.nameConflicts(let accounts) {
      conflict = PendingConflict(provider: provider, idToken: idToken, name: name, accounts: accounts)
    } catch {
      show(error)
    }
  }

  private func show(_ error: Error) {
    errorMessage = (error as? APIError)?.message ?? APIError.network("").message
    errorTick += 1
  }
}

#Preview("Sign in") {
  SignInView()
    .environment(AppModel.preview(signedIn: false))
}

#Preview("Sign in · dark, largest text") {
  SignInView()
    .environment(AppModel.preview(signedIn: false))
    .preferredColorScheme(.dark)
    .dynamicTypeSize(.accessibility5)
}

/// The sign-in screen's buttons, all exactly the height of Apple's own
/// Sign in with Apple button so the three stack as one set. A system
/// `.borderedProminent` adds its own padding around the label, which made the
/// password button visibly thicker than Apple's.
struct SignInButtonStyle: ButtonStyle {
  enum Kind { case primary, google }
  static let height: CGFloat = 50
  let kind: Kind
  @Environment(\.isEnabled) private var isEnabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.body.weight(.semibold))
      .foregroundStyle(foreground)
      .frame(maxWidth: .infinity)
      .frame(height: Self.height)
      .background(Capsule().fill(background))
      // Google's button: white with a thin grey outline (#747775), dark
      // (#131314) with #8E918F in dark mode — its sign-in branding guidelines.
      .overlay {
        if kind == .google { Capsule().strokeBorder(googleBorder, lineWidth: 1) }
      }
      .opacity(configuration.isPressed ? 0.75 : 1)
      .contentShape(Capsule())
  }

  @Environment(\.colorScheme) private var colorScheme

  private var foreground: Color {
    switch kind {
    case .primary: .white
    case .google: colorScheme == .dark ? Color(white: 0.89) : Color(red: 0x1F / 255, green: 0x1F / 255, blue: 0x1F / 255)
    }
  }

  private var background: Color {
    switch kind {
    case .primary: isEnabled ? .accentColor : Color.secondary.opacity(0.35)
    case .google: colorScheme == .dark ? Color(red: 0x13 / 255, green: 0x13 / 255, blue: 0x14 / 255) : .white
    }
  }

  private var googleBorder: Color {
    colorScheme == .dark
      ? Color(red: 0x8E / 255, green: 0x91 / 255, blue: 0x8F / 255)
      : Color(red: 0x74 / 255, green: 0x77 / 255, blue: 0x75 / 255)
  }
}
