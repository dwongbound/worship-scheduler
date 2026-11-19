import SwiftUI
import TapWorshipKit

/// The first screen for someone signed out: the brand; Sign in (opens the
/// password form), "or", Google and Apple; and Sign up at the bottom. The
/// landing itself never shows a text field.
struct WelcomeView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.openURL) private var openURL
  @State private var path: [Route] = []

  enum Route: Hashable { case signUp, signIn }

  var body: some View {
    NavigationStack(path: $path) {
      VStack(spacing: 0) {
        Spacer()
        BrandHeader()
        Spacer()
        VStack(spacing: 12) {
          Button {
            path.append(.signIn)
          } label: {
            Text("Sign in")
          }
          .buttonStyle(ActionButtonStyle(kind: .primary))

          OrDivider()
            .padding(.vertical, 4)

          SocialSignInButtons()
        }
        .padding(.horizontal, 20)

        Spacer()

        // New here? Sign up sits apart at the bottom, as the less common path.
        VStack(spacing: 6) {
          Text("New to TapWorship?")
            .font(TW.subheadline)
            .foregroundStyle(.secondary)
          Button {
            if model.readOnly {
              // The preview can't create accounts on tapworship.com; the
              // website can.
              openURL(AppConfig.baseURL.appending(path: "login"))
            } else {
              path.append(.signUp)
            }
          } label: {
            Text("Sign up")
          }
          .buttonStyle(ActionButtonStyle(kind: .outline))
          if model.readOnly {
            Text("Opens tapworship.com. This preview can't create accounts.")
              .font(TW.footnote)
              .foregroundStyle(.secondary)
              .multilineTextAlignment(.center)
          }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
      }
      .background(Color(.systemGroupedBackground))
      .navigationDestination(for: Route.self) { route in
        switch route {
        case .signUp: SignUpView()
        case .signIn: SignInView()
        }
      }
    }
  }
}

/// A new account with a password and the org key, the web's "Sign up". It
/// creates the account, signs in, then joins the org, so the person lands in
/// the app ready to go.
struct SignUpView: View {
  @Environment(AppModel.self) private var model

  @State private var firstName = ""
  @State private var lastName = ""
  @State private var email = ""
  @State private var password = ""
  @State private var confirm = ""
  @State private var orgKey = ""
  @State private var working = false
  @State private var error: String?
  @State private var errorTick = 0
  @State private var nameConflicts: [ExistingAccount]?
  @FocusState private var focus: Field?

  private enum Field: Hashable { case first, last, email, password, confirm, key }

  private var form: SignUpForm {
    SignUpForm(firstName: firstName, lastName: lastName, email: email, password: password, orgKey: orgKey)
  }
  private var problem: String? { form.problem(confirm: confirm) }

  var body: some View {
    Form { Group {
      Section {
        TextField("First name", text: $firstName)
          .textContentType(.givenName)
          .submitLabel(.next)
          .focused($focus, equals: .first)
          .onSubmit { focus = .last }
        TextField("Last name", text: $lastName)
          .textContentType(.familyName)
          .submitLabel(.next)
          .focused($focus, equals: .last)
          .onSubmit { focus = .email }
      }

      Section {
        TextField("Email", text: $email)
          .textContentType(.emailAddress)
          .keyboardType(.emailAddress)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .submitLabel(.next)
          .focused($focus, equals: .email)
          .onSubmit { focus = .password }
        SecureField("Password", text: $password)
          .textContentType(.newPassword)
          .submitLabel(.next)
          .focused($focus, equals: .password)
          .onSubmit { focus = .confirm }
        SecureField("Confirm password", text: $confirm)
          .textContentType(.newPassword)
          .submitLabel(.next)
          .focused($focus, equals: .confirm)
          .onSubmit { focus = .key }
      } footer: {
        Text("You'll sign in with this email. At least \(ProfileRules.minPasswordLength) characters.")
      }

      Section {
        TextField("Organization key", text: $orgKey)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .submitLabel(.join)
          .focused($focus, equals: .key)
          .onSubmit { Task { await submit() } }
      } footer: {
        if let error {
          Label(error, systemImage: "exclamationmark.circle")
            .foregroundStyle(.red)
        } else {
          Text("Your worship team's admin gives out this key.")
        }
      }

      Section {
        Button {
          Task { await submit() }
        } label: {
          ZStack {
            Text("Create account").opacity(working ? 0 : 1)
            if working { ProgressView().tint(.white).accessibilityLabel("Creating your account") }
          }
        }
        .buttonStyle(ActionButtonStyle(kind: .primary))
        .disabled(problem != nil || working)
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
      } footer: {
        // Say what's missing once everything has been touched, not before.
        if let problem, !firstName.isEmpty, !email.isEmpty, !password.isEmpty, !confirm.isEmpty, error == nil {
          Text(problem)
        }
      }
    }
.listRowBackground(Color.twCard)
}.twList()
    .navigationTitle("Sign up")
    .navigationBarTitleDisplayMode(.inline)
    .safeAreaInset(edge: .top) {
      if AppConfig.isDevServer { DevServerBadge().padding(.bottom, 4) }
    }
    .animation(.default, value: error)
    .sensoryFeedback(.error, trigger: errorTick)
    .onAppear { if firstName.isEmpty { focus = .first } }
    .alert(
      "Is this you?",
      isPresented: Binding(get: { nameConflicts != nil }, set: { if !$0 { nameConflicts = nil } }),
      presenting: nameConflicts
    ) { _ in
      Button("It's me, I'll sign in instead") { nameConflicts = nil }
      Button("Not me, create my account") {
        nameConflicts = nil
        Task { await submit(allowDuplicateName: true) }
      }
    } message: { accounts in
      let first = accounts.first
      Text("Someone named \(first?.name ?? "this") already has an account (\(first?.email ?? "another address")). If that's you, sign in with it so your sets stay in one place.")
    }
  }

  private func submit(allowDuplicateName: Bool = false) async {
    guard problem == nil, !working else { return }
    focus = nil
    working = true
    error = nil
    defer { working = false }
    var request = form.cleaned
    request.allowDuplicateName = allowDuplicateName
    do {
      let result = try await model.api.signUp(request)
      // The account exists now; sign in with it.
      try await model.signIn(username: request.email, password: request.password)
      // A claimed account is already in its org; a new one joins with the key.
      // If the key fails here the person is signed in with no org, and the
      // app shows the join screen where they can try another key.
      if result.claimed != true {
        try? await model.joinOrg(key: request.orgKey)
      }
    } catch APIError.nameConflicts(let accounts) {
      nameConflicts = accounts
    } catch {
      if let message = model.handle(error) {
        self.error = message
        errorTick += 1
      }
    }
  }
}

#Preview("Welcome") {
  WelcomeView()
    .environment(AppModel.preview(signedIn: false))
}

#Preview("Sign up") {
  NavigationStack { SignUpView() }
    .environment(AppModel.preview(signedIn: false))
}
