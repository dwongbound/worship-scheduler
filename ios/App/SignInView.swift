import AuthenticationServices
import SwiftUI
import TapWorshipKit

/// Signing in with a username or email and a password (the web's /login),
/// pushed from the landing screen's Sign in button. Apple and Google live on
/// the landing itself (SocialSignInButtons).
struct SignInView: View {
  @Environment(AppModel.self) private var model

  @State private var username = ""
  @State private var password = ""
  @State private var busy = false
  @State private var errorMessage: String?
  @State private var errorTick = 0
  @FocusState private var focus: Field?

  private enum Field { case username, password }

  private var canSubmit: Bool {
    !username.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty && !busy
  }

  var body: some View {
    Form { Group {
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
            Text("Sign in").opacity(busy ? 0 : 1)
            if busy { ProgressView().tint(.white).accessibilityLabel("Signing in") }
          }
        }
        .buttonStyle(ActionButtonStyle(kind: .primary))
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
        .disabled(!canSubmit)
      }
    }
.listRowBackground(Color.twCard)
}.twList()
    .navigationTitle("Sign in")
    .navigationBarTitleDisplayMode(.inline)
    .animation(.default, value: errorMessage)
    .sensoryFeedback(.error, trigger: errorTick)
    .onAppear { if username.isEmpty { focus = .username } }
    .safeAreaInset(edge: .top) {
      if AppConfig.isDevServer { DevServerBadge().padding(.bottom, 4) }
    }
  }

  private func submitPassword() {
    guard canSubmit else { return }
    focus = nil
    errorMessage = nil
    busy = true
    Task {
      defer { busy = false }
      do {
        try await model.signIn(username: username.trimmingCharacters(in: .whitespaces), password: password)
      } catch {
        password = ""
        errorMessage = (error as? APIError)?.message ?? APIError.network("").message
        errorTick += 1
        focus = .password
      }
    }
  }
}

/// Google and Apple, stacked 12pt apart at the same height. Either can also
/// CREATE an account, as the web's Google sign-in does; a brand-new account
/// then lands on JoinOrgView. Both offered at the same size is what App Store
/// rule 4.8 asks of an app that offers Google.
struct SocialSignInButtons: View {
  @Environment(AppModel.self) private var model
  @Environment(\.webAuthenticationSession) private var webAuthSession
  @Environment(\.colorScheme) private var colorScheme

  @State private var busy: Provider?
  @State private var errorMessage: String?
  @State private var errorTick = 0
  @State private var conflict: PendingConflict?

  private enum Provider { case apple, google }

  /// A sign-in waiting on "is that you?", kept so "Not me" can retry with
  /// the same token instead of sending the person through the sheet again.
  private struct PendingConflict: Identifiable {
    let id = UUID()
    let provider: SocialProvider
    let idToken: String
    let name: String?
    let accounts: [ExistingAccount]
  }

  var body: some View {
    VStack(spacing: 12) {
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
        .buttonStyle(ActionButtonStyle(kind: .google))
        .disabled(busy != nil)
      }

      SignInWithAppleButton(.signIn) { request in
        request.requestedScopes = [.fullName, .email]
      } onCompletion: { result in
        handleApple(result)
      }
      .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
      // Apple's button is a UIKit view that keeps the style it was made
      // with; rebuild it when the theme flips (the app's own Light/Dark
      // setting lands just after launch), or it draws black on black.
      .id(colorScheme)
      .frame(height: ActionButtonStyle.height)
      .clipShape(Capsule())
      .disabled(busy != nil)
      .opacity(busy == .apple ? 0.5 : 1)

      if let errorMessage {
        Label(errorMessage, systemImage: "exclamationmark.circle")
          .font(.footnote)
          .foregroundStyle(.red)
          .transition(.opacity)
      }
    }
    .animation(.default, value: errorMessage)
    .sensoryFeedback(.error, trigger: errorTick)
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

/// "—— or ——".
struct OrDivider: View {
  var body: some View {
    HStack(spacing: 12) {
      VStack { Divider() }
      Text("or")
        .font(.subheadline)
        .foregroundStyle(.secondary)
      VStack { Divider() }
    }
    .accessibilityHidden(true)
  }
}

/// The logo, name and tagline, on the landing screen.
struct BrandHeader: View {
  var body: some View {
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
      if AppConfig.isDevServer { DevServerBadge() }
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 8)
  }
}

/// A dev or staging build must never pass for the real thing.
struct DevServerBadge: View {
  var body: some View {
    Text("Development build · \(AppConfig.baseURL.host ?? "dev server")")
      .font(.footnote.weight(.medium))
      .foregroundStyle(.orange)
  }
}

#Preview("Sign in") {
  NavigationStack { SignInView() }
    .environment(AppModel.preview(signedIn: false))
}

#Preview("Sign in · dark, largest text") {
  NavigationStack { SignInView() }
    .environment(AppModel.preview(signedIn: false))
    .preferredColorScheme(.dark)
    .dynamicTypeSize(.accessibility5)
}

/// The app's one full-width button, used wherever an action deserves a big
/// button (sign in, create account, send, delete forever). Always exactly the
/// height of Apple's own Sign in with Apple button, so every big button in the
/// app matches. A system `.borderedProminent` adds its own padding around the
/// label, which made buttons visibly thicker than Apple's.
///
/// Everything else (Remove from org, Delete set, Confirm…) is a plain list
/// row at the system's standard height.
struct ActionButtonStyle: ButtonStyle {
  /// `outline` is the plain white, outlined button (the landing's Sign in);
  /// `google` is the same shape, which is Google's own branded style.
  enum Kind { case primary, destructive, google, outline }
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
        if kind == .google || kind == .outline { Capsule().strokeBorder(googleBorder, lineWidth: 1) }
      }
      .opacity(configuration.isPressed ? 0.75 : 1)
      .contentShape(Capsule())
  }

  @Environment(\.colorScheme) private var colorScheme

  private var foreground: Color {
    switch kind {
    case .primary, .destructive: .white
    case .google, .outline: colorScheme == .dark ? Color(white: 0.89) : Color(red: 0x1F / 255, green: 0x1F / 255, blue: 0x1F / 255)
    }
  }

  private var background: Color {
    switch kind {
    case .primary: isEnabled ? .accentColor : Color.secondary.opacity(0.35)
    case .destructive: isEnabled ? .red : Color.secondary.opacity(0.35)
    case .google, .outline: colorScheme == .dark ? Color(red: 0x13 / 255, green: 0x13 / 255, blue: 0x14 / 255) : .white
    }
  }

  private var googleBorder: Color {
    colorScheme == .dark
      ? Color(red: 0x8E / 255, green: 0x91 / 255, blue: 0x8F / 255)
      : Color(red: 0x74 / 255, green: 0x77 / 255, blue: 0x75 / 255)
  }
}
