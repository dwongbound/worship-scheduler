import SwiftUI
import TapWorshipKit

// Editing a set from its page. Each sheet stages its changes and saves them in
// one request with Save, like the web's set modal; Close leaves without saving
// (and asks first if there's something to lose).

// MARK: Setlist

struct SetlistEditorSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let set: ApiSet
  let saved: () async -> Void

  @State private var songs: [Setlist.Draft] = []
  @State private var saving = false
  @State private var error: String?
  @State private var confirmDiscard = false

  private var changed: Bool { Setlist.changed(songs, from: set.songs) }

  var body: some View {
    NavigationStack {
      List {
        Section {
          ForEach($songs) { $song in
            HStack(spacing: 12) {
              TextField("Song title", text: $song.title)
              Picker("Key", selection: $song.key) {
                Text("No key").tag(String?.none)
                ForEach(Setlist.keys, id: \.self) { Text($0).tag(String?.some($0)) }
              }
              .labelsHidden()
              .fixedSize()
            }
          }
          .onDelete { songs.remove(atOffsets: $0) }
          .onMove { songs.move(fromOffsets: $0, toOffset: $1) }
          if songs.count < Setlist.maxSongs {
            Button {
              songs.append(Setlist.Draft(title: "", key: nil))
            } label: {
              Label("Add song", systemImage: "plus")
            }
          }
        } footer: {
          if let error {
            Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.red)
          } else {
            Text("Drag to reorder, swipe left to remove. Everyone on the set sees the changes.")
          }
        }
      }
      .environment(\.editMode, .constant(.active))
      .navigationTitle("Setlist")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { changed ? (confirmDiscard = true) : dismiss() }
            .disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saving { ProgressView() } else {
            Button("Save") { Task { await save() } }.disabled(!changed)
          }
        }
      }
      .confirmationDialog("Discard your setlist changes?", isPresented: $confirmDiscard, titleVisibility: .visible) {
        Button("Discard changes", role: .destructive) { dismiss() }
      }
      .interactiveDismissDisabled(changed || saving)
      .onAppear { if songs.isEmpty { songs = Setlist.drafts(from: set.songs) } }
    }
  }

  private func save() async {
    saving = true
    error = nil
    do {
      try await model.api.saveSetlist(setId: set.id, songs: Setlist.body(songs))
      await saved()
      dismiss()
    } catch {
      self.error = model.handle(error)
    }
    saving = false
  }
}

// MARK: Roster

/// An admin's roster edit: change who sits where, remove people, fill open
/// seats. Saved as one diff, so the team gets one Slack notice for the lot.
struct RosterEditorSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let set: ApiSet
  let saved: () async -> Void

  @State private var seats: [SeatDraft] = []
  @State private var users: [ApiAdminUser]?
  @State private var loadError: String?
  @State private var picking: Pick?
  @State private var saving = false
  @State private var error: String?
  @State private var confirmDiscard = false

  /// What the picker is choosing for: a new seat in a role, or a seat to hand over.
  struct Pick: Identifiable {
    let id = UUID()
    let role: SetEditingRole
    let replacing: UUID?
  }
  typealias SetEditingRole = RosterEditing.EditableRole

  private var diff: RosterDiff { RosterEditing.diff(original: set, edited: seats) }
  private var roles: [SetEditingRole] { RosterEditing.editableRoles(set) }
  private var guestSeats: [SeatDraft] { seats.filter { $0.guestTeamId != nil } }

  var body: some View {
    NavigationStack {
      Group {
        if users != nil {
          list
        } else if let loadError {
          ContentUnavailableView {
            Label("Couldn't load the team", systemImage: "wifi.exclamationmark")
          } description: {
            Text(loadError)
          } actions: {
            Button("Try again") { Task { await load() } }
          }
        } else {
          ProgressView()
        }
      }
      .navigationTitle("Edit roster")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { diff.isEmpty ? dismiss() : (confirmDiscard = true) }
            .disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saving { ProgressView() } else {
            Button("Save") { Task { await save() } }.disabled(diff.isEmpty)
          }
        }
      }
      .confirmationDialog("Discard your roster changes?", isPresented: $confirmDiscard, titleVisibility: .visible) {
        Button("Discard changes", role: .destructive) { dismiss() }
      }
      .interactiveDismissDisabled(!diff.isEmpty || saving)
      .sheet(item: $picking) { pick in
        CandidatePicker(
          role: pick.role,
          candidates: RosterEditing.candidates(
            users: users ?? [],
            role: pick.role.key,
            teamId: set.teamId,
            taken: Set(seats.filter { $0.role == pick.role.key && $0.guestTeamId == nil }.map(\.userId))
          )
        ) { candidate in
          choose(candidate, for: pick)
        }
      }
      .task {
        if seats.isEmpty { seats = RosterEditing.seats(of: set) }
        if users == nil { await load() }
      }
    }
  }

  private var list: some View {
    List {
      ForEach(roles) { role in
        let inRole = seats.filter { $0.role == role.key && $0.guestTeamId == nil }
        Section {
          ForEach(inRole) { seat in
            HStack {
              Text(seat.name)
              Spacer()
              Menu {
                Button("Change person", systemImage: "arrow.left.arrow.right") {
                  picking = Pick(role: role, replacing: seat.id)
                }
                Button("Remove from \(role.label)", systemImage: "minus.circle", role: .destructive) {
                  seats.removeAll { $0.id == seat.id }
                }
              } label: {
                Image(systemName: "ellipsis.circle")
                  .imageScale(.large)
                  // A wide tap area without making the row taller than its neighbours.
                  .frame(minWidth: 44)
                  .contentShape(Rectangle())
              }
              .accessibilityLabel("Options for \(seat.name)")
            }
            .swipeActions {
              Button("Remove", role: .destructive) { seats.removeAll { $0.id == seat.id } }
            }
          }
          if inRole.count < role.capacity {
            Button {
              picking = Pick(role: role, replacing: nil)
            } label: {
              Label(
                role.capacity - inRole.count == 1 ? "Add \(role.label)" : "Add \(role.label) · \(role.capacity - inRole.count) open",
                systemImage: "plus.circle"
              )
            }
          }
        } header: {
          Text(role.label)
        }
      }
      if !guestSeats.isEmpty {
        Section {
          ForEach(guestSeats) { seat in
            LabeledContent(seat.name, value: RoleLabels.label(for: seat.role))
              .swipeActions {
                Button("Remove", role: .destructive) { seats.removeAll { $0.id == seat.id } }
              }
          }
        } header: {
          Text("Borrowed from other teams")
        } footer: {
          Text("Swipe to remove. Adding people from another team is on the web.")
        }
      }
      Section {
      } footer: {
        if let error {
          Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.red)
        } else if !diff.isEmpty {
          Text("\(RosterEditing.summary(diff)). Saving tells the people affected.")
        }
      }
    }
    .listStyle(.insetGrouped)
  }

  private func choose(_ candidate: RosterEditing.Candidate, for pick: Pick) {
    if let replacing = pick.replacing, let index = seats.firstIndex(where: { $0.id == replacing }) {
      seats[index].userId = candidate.id
      seats[index].name = candidate.name
    } else {
      seats.append(SeatDraft(assignmentId: nil, role: pick.role.key, userId: candidate.id, name: candidate.name, guestTeamId: nil))
    }
  }

  private func load() async {
    guard let orgId = set.org?.id else {
      loadError = "This set has no organization."
      return
    }
    loadError = nil
    do {
      users = try await model.api.adminUsers(orgId: orgId)
    } catch {
      loadError = model.handle(error)
    }
  }

  private func save() async {
    saving = true
    error = nil
    do {
      try await model.api.saveRoster(setId: set.id, diff: diff)
      await saved()
      dismiss()
    } catch {
      self.error = model.handle(error)
    }
    saving = false
  }
}

/// Who to put in a role: the team's players for it, paused people last.
struct CandidatePicker: View {
  @Environment(\.dismiss) private var dismiss
  let role: RosterEditing.EditableRole
  let candidates: [RosterEditing.Candidate]
  let choose: (RosterEditing.Candidate) -> Void
  @State private var query = ""

  private var shown: [RosterEditing.Candidate] {
    let q = query.trimmingCharacters(in: .whitespaces)
    return q.isEmpty ? candidates : candidates.filter { $0.name.localizedCaseInsensitiveContains(q) }
  }

  var body: some View {
    NavigationStack {
      List {
        if candidates.isEmpty {
          ContentUnavailableView(
            "Nobody else plays \(role.label)",
            systemImage: "person.slash",
            description: Text("Give someone this role on the Team tab first.")
          )
        }
        ForEach(shown) { candidate in
          Button {
            choose(candidate)
            dismiss()
          } label: {
            HStack {
              Text(candidate.name)
                .foregroundStyle(Color.primary)
              Spacer()
              if candidate.inactive {
                Text("Paused").font(.caption).foregroundStyle(.secondary)
              }
            }
          }
        }
      }
      .searchable(text: $query, prompt: "Search")
      .navigationTitle(role.label)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }
        }
      }
    }
    .presentationDetents([.medium, .large])
  }
}

// MARK: Practices

struct AddPracticeSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let set: ApiSet
  let saved: () async -> Void

  @State private var start: Date
  @State private var end: Date
  @State private var saving = false
  @State private var error: String?

  init(set: ApiSet, saved: @escaping () async -> Void) {
    self.set = set
    self.saved = saved
    // Default: 7–9 PM three days before the set, a typical midweek rehearsal.
    let calendar = Calendar.current
    let day = calendar.date(byAdding: .day, value: -3, to: set.startsAt) ?? set.startsAt
    let start = calendar.date(bySettingHour: 19, minute: 0, second: 0, of: day) ?? day
    _start = State(initialValue: start)
    _end = State(initialValue: start.addingTimeInterval(2 * 3600))
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          DatePicker("Starts", selection: $start)
          DatePicker("Ends", selection: $end, in: start...)
        } footer: {
          if let error {
            Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.red)
          } else if let problem = PracticeRules.problem(start: start, end: end) {
            Text(problem)
          } else {
            Text("Everyone on the set gets a calendar invite, and it follows any roster change.")
          }
        }
      }
      .navigationTitle("Add practice")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }.disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saving { ProgressView() } else {
            Button("Add") { Task { await save() } }
              .disabled(PracticeRules.problem(start: start, end: end) != nil)
          }
        }
      }
      .onChange(of: start) { old, new in
        // Keep the length when the start moves, like Calendar does.
        end = new.addingTimeInterval(end.timeIntervalSince(old))
      }
    }
    .presentationDetents([.medium])
  }

  private func save() async {
    saving = true
    error = nil
    do {
      try await model.api.addPractice(setId: set.id, startsAt: start, endsAt: end)
      await saved()
      dismiss()
    } catch {
      self.error = model.handle(error)
    }
    saving = false
  }
}

// MARK: New set

/// An admin's one-off set (the web's Create Set on the calendar). Weekly
/// times and generating a schedule stay on the web's Create tab.
struct NewSetSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let day: Date
  let created: () async -> Void

  @State private var label = ""
  @State private var start: Date
  @State private var end: Date
  @State private var teams: [ApiOrgTeam]?
  @State private var teamId: String?
  @State private var saving = false
  @State private var error: String?

  init(day: Date, created: @escaping () async -> Void) {
    self.day = day
    self.created = created
    let start = Calendar.current.date(bySettingHour: 10, minute: 0, second: 0, of: day) ?? day
    _start = State(initialValue: start)
    _end = State(initialValue: start.addingTimeInterval(90 * 60))
  }

  private var newSet: NewSet? {
    teamId.map { NewSet(label: label, startsAt: start, endsAt: end, teamId: $0) }
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Name (optional)", text: $label)
          if let teams {
            Picker("Team", selection: $teamId) {
              if teamId == nil { Text("Choose").tag(String?.none) }
              ForEach(teams) { Text($0.name).tag(String?.some($0.id)) }
            }
          } else {
            LabeledContent("Team") { ProgressView() }
          }
        }
        Section {
          DatePicker("Starts", selection: $start)
          DatePicker("Ends", selection: $end, in: start...)
        } footer: {
          if let error {
            Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.red)
          } else if let problem = newSet?.problem {
            Text(problem)
          } else {
            Text("The team's usual roles, with nobody on it yet. Add people from the set's page.")
          }
        }
      }
      .navigationTitle("New set")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }.disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saving { ProgressView() } else {
            Button("Create") { Task { await save() } }
              .disabled(newSet == nil || newSet?.problem != nil)
          }
        }
      }
      .onChange(of: start) { old, new in
        end = new.addingTimeInterval(end.timeIntervalSince(old))
      }
      .task { await loadTeams() }
    }
  }

  private func loadTeams() async {
    if model.adminOrgs == nil { await model.refreshAdminOrgs() }
    var all: [ApiOrgTeam] = []
    for org in model.adminOrgs ?? [] {
      if let teams = try? await model.api.teams(orgId: org.orgId) { all += teams }
    }
    teams = all
    if all.count == 1 { teamId = all.first?.id }
  }

  private func save() async {
    guard let newSet, newSet.problem == nil else { return }
    saving = true
    error = nil
    do {
      try await model.api.createSet(newSet)
      await created()
      dismiss()
    } catch {
      self.error = model.handle(error)
    }
    saving = false
  }
}
