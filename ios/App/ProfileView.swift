import SwiftUI
import TapWorshipKit

/// The web's /profile, in the app: name and email, password, my teams and
/// roles, Google Calendar invites and the daily summary. Switches save as
/// they're flipped and spring back if the server refuses, like iOS Settings;
/// text fields save with the Save button.
struct ProfileView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.openURL) private var openURL

  @State private var profile: ApiProfile?
  @State private var loadError: String?

  @State private var name = ""
  @State private var email = ""
  @State private var saving = false
  @State private var saveError: String?
  @State private var savedTick = 0

  @State private var changingPassword = false
  @State private var askWithdraw = false

  private var nameChanged: Bool {
    guard let profile else { return false }
    return ProfileRules.cleanName(name) != profile.name || ProfileRules.cleanEmail(email) != profile.email
  }

  var body: some View {
    Group {
      if let profile {
        form(profile).loadedContent()
      } else if let loadError {
        BrandedEmpty(title: "Couldn't load your profile", systemImage: "wifi.exclamationmark", message: loadError) {
          Button("Try again") { Task { await load() } }
        }
      } else {
        // The profile's own shape, greyed and shimmering, while it loads.
        Form { Group {
          Section("Name and email") {
            Text("Firstname Lastname")
            Text("someone@example.com")
          }
          Section("My teams") {
            Text("Sunday Team")
            Text("Worship Leader, Vox")
          }
          Section { Text("Morning summary") }
        }
.listRowBackground(Color.twCard)
}.twList()
        .skeleton("Loading your profile")
      }
    }
    .animation(.smooth(duration: 0.35), value: profile == nil)
    .navigationTitle("Profile")
    .navigationBarTitleDisplayMode(.inline)
    .task { if profile == nil { await load() } }
    .refreshable { await load() }
    .sensoryFeedback(.success, trigger: savedTick)
  }

  private func form(_ me: ApiProfile) -> some View {
    Form { Group {
      Section {
        TextField("Name", text: $name)
          .textContentType(.name)
          .disabled(model.readOnly)
          .submitLabel(.done)
        TextField("Email", text: $email)
          .textContentType(.emailAddress)
          .keyboardType(.emailAddress)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .disabled(!me.hasPassword || model.readOnly)
          .foregroundStyle(me.hasPassword ? .primary : .secondary)
      } header: {
        Text("Name and email")
      } footer: {
        if let saveError {
          Label(saveError, systemImage: "exclamationmark.circle").foregroundStyle(.red)
        } else if model.readOnly {
          Text("Read-only preview: edit your profile on tapworship.com.")
        } else if !me.hasPassword {
          Text("You sign in with Google or Apple, so your email comes from that account.")
        } else {
          Text("Your email is where calendar invites for your sets go.")
        }
      }

      if me.hasPassword && !model.readOnly {
        Section {
          Button("Change password") { changingPassword = true }
        }
      }

      Section {
        if me.teams.isEmpty {
          Text("You're not on a team yet").foregroundStyle(.secondary)
        }
        ForEach(me.teams) { team in
          VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
              Text(team.name).font(TW.headline)
              if me.memberships.count > 1, let org = me.orgName(for: team) {
                Text(org).font(TW.caption).foregroundStyle(.secondary)
              }
              Spacer()
              if !team.active {
                Text("Paused")
                  .font(TW.caption.weight(.semibold))
                  .padding(.horizontal, 8).padding(.vertical, 2)
                  .background(.gray.opacity(0.15), in: Capsule())
                  .foregroundStyle(.secondary)
              }
            }
            Text(team.roleLabels.isEmpty ? "No roles yet" : team.roleLabels.joined(separator: ", "))
              .font(TW.subheadline)
              .foregroundStyle(.secondary)
          }
          .padding(.vertical, 2)
          .accessibilityElement(children: .combine)
        }
      } header: {
        Text("My teams")
      } footer: {
        Text("Set by your org admin.")
      }

      if me.email != nil {
        Section {
          Toggle("Put my sets on my calendar", isOn: Binding(
            get: { profile?.calendarInvites ?? true },
            set: { on in Task { await setInvites(on) } }
          ))
          .disabled(model.readOnly)
          if me.calendarInvites {
            Toggle("Email me about changes", isOn: Binding(
              get: { profile?.calendarInviteEmails ?? true },
              set: { on in Task { await save { $0.calendarInviteEmails = on } } }
            ))
            .disabled(model.readOnly)
          }
        } header: {
          Text("Google Calendar")
        } footer: {
          if me.calendarInvites, let address = me.inviteAddress {
            Text("Invites go to \(address).")
          } else {
            Text("You stay on the roster, without invites.")
          }
        }
      }

      Section {
        Toggle("Morning summary", isOn: Binding(
          get: { profile?.dailyDigest ?? true },
          set: { on in Task { await save { $0.dailyDigest = on } } }
        ))
        .disabled(model.readOnly)
      } footer: {
        EmptyView()
      }

      Section {
        Button {
          openURL(AppConfig.baseURL.appending(path: "profile"))
        } label: {
          Label("Slack and more on the web", systemImage: "safari")
        }
      } footer: {
        EmptyView()
      }
    }
.listRowBackground(Color.twCard)
}.twList()
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        if saving {
          ProgressView()
        } else if nameChanged && !model.readOnly {
          Button("Save") { Task { await saveNameAndEmail() } }
            .disabled(ProfileRules.cleanName(name) == nil)
        }
      }
    }
    .confirmationDialog(
      "Also remove the invites you already have?",
      isPresented: $askWithdraw,
      titleVisibility: .visible
    ) {
      Button("Remove them") { Task { await save { $0.calendarInvites = false; $0.withdrawInvites = true } } }
      Button("Keep them", role: .cancel) {}
    } message: {
      Text("New sets won't be added either way.")
    }
    .sheet(isPresented: $changingPassword) {
      ChangePasswordSheet(profile: me)
    }
  }

  private func load() async {
    loadError = nil
    do {
      let fresh = try await model.api.profile()
      withAnimation(.easeInOut(duration: 0.35)) { profile = fresh }
      name = fresh.name ?? ""
      email = fresh.email ?? ""
    } catch {
      loadError = model.handle(error)
    }
  }

  /// Saves one change on top of my current name and email, then reloads.
  /// On failure the reload puts the switch back where the server has it.
  private func save(_ change: (inout ProfileUpdate) -> Void) async {
    guard let current = profile else { return }
    var update = ProfileUpdate(keeping: current)
    change(&update)
    saving = true
    saveError = nil
    do {
      try await model.api.updateProfile(update)
      savedTick += 1
    } catch {
      saveError = model.handle(error)
    }
    let typedName = name, typedEmail = email
    await load()
    // A switch save shouldn't throw away an unsaved name or email edit.
    name = typedName
    email = typedEmail
    saving = false
  }

  /// Off saves first, then asks about invites already sent — so a dismissed
  /// question can't leave the switch disagreeing with the server (the web
  /// does the same).
  private func setInvites(_ on: Bool) async {
    await save { $0.calendarInvites = on }
    if !on && saveError == nil { askWithdraw = true }
  }

  private func saveNameAndEmail() async {
    guard let current = profile, let cleanName = ProfileRules.cleanName(name) else { return }
    var update = ProfileUpdate(keeping: current)
    update.name = cleanName
    update.email = current.hasPassword ? ProfileRules.cleanEmail(email) : current.email
    saving = true
    saveError = nil
    do {
      try await model.api.updateProfile(update)
      model.renameSession(to: cleanName)
      savedTick += 1
      await load()
    } catch {
      saveError = model.handle(error)
    }
    saving = false
  }
}

/// New password, twice. The server wants 8+ characters.
struct ChangePasswordSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let profile: ApiProfile

  @State private var password = ""
  @State private var confirm = ""
  @State private var working = false
  @State private var error: String?
  @FocusState private var focused: Bool

  private var problem: String? { ProfileRules.passwordProblem(password, confirm: confirm) }

  var body: some View {
    NavigationStack {
      Form { Group {
        Section {
          SecureField("New password", text: $password)
            .textContentType(.newPassword)
            .focused($focused)
          SecureField("Confirm new password", text: $confirm)
            .textContentType(.newPassword)
        } footer: {
          if let error {
            Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.red)
          } else if !password.isEmpty, !confirm.isEmpty, let problem {
            Text(problem)
          } else {
            Text("At least \(ProfileRules.minPasswordLength) characters.")
          }
        }
      }
.listRowBackground(Color.twCard)
}.twList()
      .navigationTitle("Change password")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }.disabled(working)
        }
        ToolbarItem(placement: .confirmationAction) {
          if working {
            ProgressView()
          } else {
            Button("Save") { Task { await save() } }.disabled(problem != nil)
          }
        }
      }
      .onAppear { focused = true }
      .interactiveDismissDisabled(working)
    }
    .presentationDetents([.medium])
  }

  private func save() async {
    guard problem == nil else { return }
    var update = ProfileUpdate(keeping: profile)
    update.password = password
    working = true
    error = nil
    do {
      try await model.api.updateProfile(update)
      dismiss()
    } catch {
      self.error = model.handle(error)
    }
    working = false
  }
}
