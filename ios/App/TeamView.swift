import SwiftUI
import TapWorshipKit

/// The org's people, by team: the web's Team tab for the things an admin
/// does from a phone. Who's on which team, what they play, whether they're
/// scheduled automatically, admin and MD, and removing someone from the org.
/// Every change saves as it's made, like the web.
struct TeamView: View {
  @Environment(AppModel.self) private var model

  @State private var users: [ApiAdminUser] = []
  @State private var teams: [ApiOrgTeam] = []
  @State private var phase: Phase = .loading
  @State private var query = ""

  enum Phase: Equatable { case loading, loaded, failed(String) }

  private var sections: [(title: String, members: [ApiAdminUser])] {
    TeamList.byTeam(TeamList.filter(users, query: query), teams: teams)
  }

  var body: some View {
    NavigationStack {
      content
        .navigationTitle("Team")
        .toolbar { AdminOrgPicker() }
        .navigationDestination(for: String.self) { id in
          MemberDetailView(
            userID: id,
            users: $users,
            teams: teams
          )
        }
        .searchable(text: $query, prompt: "Name or username")
        .refreshable { await load() }
        .task(id: model.adminOrgID) { await load() }
    }
  }

  @ViewBuilder private var content: some View {
    switch phase {
    case .loading where users.isEmpty:
      List {
        Section("Band") {
          ForEach(AdminPreviewData.users) { MemberRow(user: $0, teamID: "t1") }
        }
      }
      .redacted(reason: .placeholder)
      .disabled(true)
      .accessibilityLabel("Loading your team")
    case .failed(let message) where users.isEmpty:
      ContentUnavailableView {
        Label("Couldn't load the team", systemImage: "wifi.exclamationmark")
      } description: {
        Text(message)
      } actions: {
        Button("Try Again") { Task { await load() } }
          .buttonStyle(.borderedProminent)
      }
    default:
      if users.isEmpty {
        ContentUnavailableView {
          Label("No one here yet", systemImage: "person.3")
        } description: {
          Text("People join with your org key, then show up here.")
        }
      } else if sections.isEmpty {
        ContentUnavailableView.search(text: query)
      } else {
        List {
          ForEach(sections, id: \.title) { section in
            Section {
              ForEach(section.members) { user in
                NavigationLink(value: user.id) {
                  MemberRow(user: user, teamID: teams.first { $0.name == section.title }?.id)
                }
              }
            } header: {
              Text(section.title)
            } footer: {
              if section.title == TeamList.noTeamTitle {
                Text("People on no team are never scheduled. Tap one to add them to a team.")
              }
            }
          }
        }
        .listStyle(.insetGrouped)
        .animation(.smooth, value: query)
      }
    }
  }

  private func load() async {
    guard let orgId = await model.currentAdminOrgID() else {
      phase = .failed("Couldn't find the orgs you look after.")
      return
    }
    do {
      async let people = model.api.adminUsers(orgId: orgId)
      async let catalog = model.api.teams(orgId: orgId)
      let (freshUsers, freshTeams) = try await (people, catalog)
      withAnimation(.smooth) {
        users = freshUsers.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        teams = freshTeams
      }
      phase = .loaded
    } catch {
      if let message = model.handle(error) { phase = .failed(message) }
    }
  }
}

/// One person in one team's section: what they play there, and the flags
/// worth seeing at a glance. Words, not colour alone.
struct MemberRow: View {
  let user: ApiAdminUser
  /// The section's team, so the roles shown are the ones they play there.
  let teamID: String?

  private var membership: ApiMemberTeam? { user.teams.first { $0.id == teamID } }

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        Text(user.name).font(.body.weight(.medium))
        if user.isAdmin { MemberTag("Admin", tint: .indigo) }
        if user.isMD { MemberTag("MD", tint: .purple) }
        if membership?.active == false { MemberTag("Inactive", tint: .gray) }
      }
      if let membership {
        Text(membership.roles.isEmpty ? "No roles yet" : membership.roles.map { RoleLabels.label(for: $0) }.joined(separator: ", "))
          .font(.subheadline)
          .foregroundStyle(.secondary)
      } else {
        Text("@\(user.username)")
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
  }
}

struct MemberTag: View {
  let text: String
  let tint: Color

  init(_ text: String, tint: Color) {
    self.text = text
    self.tint = tint
  }

  var body: some View {
    Text(text)
      .font(.caption2.weight(.semibold))
      .padding(.horizontal, 6)
      .padding(.vertical, 2)
      .foregroundStyle(tint)
      .background(tint.opacity(0.15), in: Capsule())
  }
}

/// One person, every switch an admin has. Each change is sent at once and
/// shown at once; a refusal puts the switch back and says why.
struct MemberDetailView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss

  let userID: String
  @Binding var users: [ApiAdminUser]
  let teams: [ApiOrgTeam]

  @State private var saving = false
  @State private var error: String?
  @State private var confirmRemove = false
  @State private var saved = 0

  private var user: ApiAdminUser? { users.first { $0.id == userID } }
  private var isMe: Bool { userID == model.session?.user.id }

  var body: some View {
    if let user {
      Form {
        Section {
          LabeledContent("Username", value: user.username)
        }

        Section {
          Toggle("Org admin", isOn: binding(user.isAdmin) { MemberPatch(isAdmin: $0) } apply: { $0.with(isAdmin: $1) })
            .disabled(isMe)
          Toggle("Musical director", isOn: binding(user.isMD) { MemberPatch(isMD: $0) } apply: { $0.with(isMD: $1) })
        } footer: {
          Text(isMe
               ? "You can't change your own admin access here, so an org is never left without one."
               : "Admins can schedule sets and see this tab. Musical directors can lead a set.")
        }

        ForEach(teams) { team in
          teamSection(team, user: user)
        }

        Section {
          Button("Remove from Org", role: .destructive) { confirmRemove = true }
            .frame(minHeight: 44)
            .disabled(isMe)
        } footer: {
          Text(isMe
               ? "To leave this org, ask another admin to remove you."
               : "Takes \(user.name) off every team and upcoming set in this org. Their account stays.")
        }
      }
      .navigationTitle(user.name)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          if saving { ProgressView().accessibilityLabel("Saving") }
        }
      }
      .sensoryFeedback(.success, trigger: saved)
      .confirmationDialog("Remove \(user.name) from this org?", isPresented: $confirmRemove, titleVisibility: .visible) {
        Button("Remove from Org", role: .destructive) { Task { await remove(user) } }
        Button("Close", role: .cancel) {}
      } message: {
        Text("They come off every team and upcoming set here. They can rejoin with the org key.")
      }
      .alert("Couldn't save that", isPresented: Binding(
        get: { error != nil },
        set: { if !$0 { error = nil } }
      ), actions: {
        Button("OK") { error = nil }
      }, message: { Text(error ?? "") })
    } else {
      ContentUnavailableView("Not in this org", systemImage: "person.crop.circle.badge.questionmark",
                             description: Text("They may have been removed."))
    }
  }

  @ViewBuilder private func teamSection(_ team: ApiOrgTeam, user: ApiAdminUser) -> some View {
    let membership = user.teams.first { $0.id == team.id }
    Section {
      Toggle("On this team", isOn: Binding(
        get: { membership != nil },
        set: { on in setTeam(team, on: on, user: user) }
      ))
      if let membership {
        Toggle("Scheduled automatically", isOn: Binding(
          get: { membership.active },
          set: { on in
            save(MemberPatch(teamActive: [.init(teamId: team.id, active: on)])) {
              $0.with(team: team.id) { $0.with(active: on) }
            }
          }
        ))
        ForEach(team.roles, id: \.key) { role in
          let plays = membership.roles.contains(role.key)
          Button {
            let roles = plays
              ? membership.roles.filter { $0 != role.key }
              : team.roles.map(\.key).filter { membership.roles.contains($0) || $0 == role.key }
            save(MemberPatch(teamRoles: [.init(teamId: team.id, roles: roles)])) {
              $0.with(team: team.id) { $0.with(roles: roles) }
            }
          } label: {
            HStack {
              Text(role.label).foregroundStyle(.primary)
              Spacer()
              Image(systemName: "checkmark")
                .fontWeight(.semibold)
                .opacity(plays ? 1 : 0)
                .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
            .frame(minHeight: 44)
          }
          .accessibilityAddTraits(plays ? .isSelected : [])
        }
      }
    } header: {
      Text(team.name)
    } footer: {
      if membership?.active == false {
        Text("Paused here: auto schedule skips them and availability requests don't ask them. You can still pick them by hand.")
      }
    }
    .animation(.smooth, value: membership != nil)
  }

  private func setTeam(_ team: ApiOrgTeam, on: Bool, user: ApiAdminUser) {
    var ids = user.teams.map(\.id)
    if on { ids.append(team.id) } else { ids.removeAll { $0 == team.id } }
    save(MemberPatch(teamIds: ids)) { current in
      var teamsNow = current.teams.filter { $0.id != team.id }
      if on { teamsNow.append(ApiMemberTeam(id: team.id, name: team.name, roles: [], active: true)) }
      return current.with(teams: teamsNow)
    }
  }

  private func binding(
    _ value: Bool,
    _ patch: @escaping (Bool) -> MemberPatch,
    apply: @escaping (ApiAdminUser, Bool) -> ApiAdminUser
  ) -> Binding<Bool> {
    Binding(get: { value }, set: { on in save(patch(on)) { apply($0, on) } })
  }

  /// Shows the change at once, sends it, and puts it back if refused.
  private func save(_ patch: MemberPatch, _ change: @escaping (ApiAdminUser) -> ApiAdminUser) {
    guard let orgId = model.adminOrgID, let index = users.firstIndex(where: { $0.id == userID }) else { return }
    let before = users[index]
    withAnimation(.smooth) { users[index] = change(before) }
    saving = true
    Task {
      defer { saving = false }
      do {
        try await model.api.updateMember(userID, patch, orgId: orgId)
        saved += 1
      } catch {
        if let i = users.firstIndex(where: { $0.id == userID }) {
          withAnimation(.smooth) { users[i] = before }
        }
        self.error = model.handle(error)
      }
    }
  }

  private func remove(_ user: ApiAdminUser) async {
    guard let orgId = model.adminOrgID else { return }
    saving = true
    defer { saving = false }
    do {
      try await model.api.removeMember(user.id, orgId: orgId)
      dismiss()
      withAnimation(.smooth) { users.removeAll { $0.id == user.id } }
    } catch {
      self.error = model.handle(error)
    }
  }
}

private extension ApiAdminUser {
  func with(isAdmin: Bool? = nil, isMD: Bool? = nil, teams: [ApiMemberTeam]? = nil) -> ApiAdminUser {
    ApiAdminUser(id: id, name: name, username: username, isMD: isMD ?? self.isMD,
                 isAdmin: isAdmin ?? self.isAdmin, teams: teams ?? self.teams)
  }

  func with(team id: String, _ change: (ApiMemberTeam) -> ApiMemberTeam) -> ApiAdminUser {
    with(teams: teams.map { $0.id == id ? change($0) : $0 })
  }
}

private extension ApiMemberTeam {
  func with(roles: [RoleKey]? = nil, active: Bool? = nil) -> ApiMemberTeam {
    ApiMemberTeam(id: id, name: name, roles: roles ?? self.roles, active: active ?? self.active)
  }
}

#Preview("Team") {
  TeamView()
    .environment(AppModel.adminPreview())
}

#Preview("Team · dark, largest text") {
  TeamView()
    .environment(AppModel.adminPreview())
    .preferredColorScheme(.dark)
    .dynamicTypeSize(.accessibility5)
}

#Preview("Team · error") {
  TeamView()
    .environment(AppModel.adminPreview(failWith: APIError.server(status: 403, message: "Forbidden")))
}

/// Holds the list a member screen edits, as TeamView does.
private struct MemberPreview: View {
  @State var users = AdminPreviewData.users
  let id: String

  var body: some View {
    NavigationStack {
      MemberDetailView(userID: id, users: $users, teams: AdminPreviewData.teams)
    }
  }
}

#Preview("Member") {
  MemberPreview(id: "u2")
    .environment(AppModel.adminPreview())
}

#Preview("Member · paused, largest text") {
  MemberPreview(id: "u1")
    .environment(AppModel.adminPreview())
    .dynamicTypeSize(.accessibility5)
}
