import SwiftUI
import TapWorshipKit
import EventKit
import EventKitUI

// The parts of a set's page shared by Calendar and My Sets, matching the web's
// set modal on a phone: the notes log and composer, who's free for a practice,
// and adding the set to your own calendar.

extension AppModel {
  /// Am I an admin of this org? (The server re-checks on every write.)
  func isAdmin(of orgId: String?) -> Bool {
    guard let orgId else { return false }
    return session?.user.memberships.contains { $0.orgId == orgId && $0.isAdmin } ?? false
  }
}

/// The set's notes: a composer for whoever may post (admins and the set's
/// worship leader), then the log, newest first. Like the web, the box is empty
/// on every open and a sent note becomes the set's current note.
struct SetNotesSection: View {
  @Environment(AppModel.self) private var model
  let setId: String
  /// The set's current note, shown when there's no log yet (older sets).
  let currentNotes: String?
  let canPost: Bool

  @State private var log: [ApiSetHistoryEvent] = []
  @State private var loaded = false
  @State private var draft = ""
  @State private var sending = false
  @State private var error: String?
  @FocusState private var composing: Bool

  var body: some View {
    if canPost || !log.isEmpty || !(currentNotes ?? "").isEmpty {
      Section {
        if canPost {
          HStack(alignment: .bottom, spacing: 8) {
            TextField("Write a note for the team", text: $draft, axis: .vertical)
              .lineLimit(1...5)
              .focused($composing)
              .disabled(sending)
            Button {
              Task { await send() }
            } label: {
              if sending {
                ProgressView()
              } else {
                Image(systemName: "arrow.up.circle.fill").font(.title2)
              }
            }
            .buttonStyle(.borderless)
            .disabled(SetNotes.ready(draft) == nil || sending)
            .accessibilityLabel("Send note")
          }
        }
        if let error {
          Label(error, systemImage: "exclamationmark.circle")
            .font(.footnote)
            .foregroundStyle(.red)
        }
        if log.isEmpty {
          if let notes = currentNotes, !notes.isEmpty {
            Text(notes)
          } else if loaded {
            Text("No notes yet").foregroundStyle(.secondary)
          }
        }
        ForEach(log) { entry in
          VStack(alignment: .leading, spacing: 4) {
            Text(SetNotes.text(fromDetail: entry.detail))
            Text("\(entry.actor?.name ?? "Someone") · \(entry.createdAt.formatted(.relative(presentation: .named)))")
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
          .accessibilityElement(children: .combine)
        }
      } header: {
        Text("Notes")
      }
      .task(id: setId) { await load() }
    }
  }

  private func load() async {
    do {
      log = try await model.api.noteLog(setId: setId)
    } catch {
      // The log is extra; the current note still shows without it.
      _ = model.handle(error)
    }
    loaded = true
  }

  private func send() async {
    guard let text = SetNotes.ready(draft) else { return }
    sending = true
    error = nil
    do {
      try await model.api.postNote(setId: setId, text: text)
      draft = ""
      composing = false
      await load()
    } catch {
      self.error = model.handle(error)
    }
    sending = false
  }
}

/// One practice row; tapping it shows who on the roster is free for it.
struct PracticeRow: View {
  let setId: String
  let practice: ApiPractice
  @State private var showing = false

  var body: some View {
    Button {
      showing = true
    } label: {
      HStack {
        VStack(alignment: .leading, spacing: 2) {
          Text(practice.startsAt, format: .dateTime.weekday(.wide).month().day())
          Text("\(practice.startsAt.formatted(date: .omitted, time: .shortened)) – \(practice.endsAt.formatted(date: .omitted, time: .shortened))")
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        Spacer()
        Text("Who's free")
          .font(.subheadline)
          .foregroundStyle(.tint)
        Image(systemName: "chevron.right")
          .font(.footnote.weight(.semibold))
          .foregroundStyle(.tertiary)
      }
    }
    // Plain, so the date reads as text and only "Who's free" is tinted.
    .buttonStyle(.plain)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
    .accessibilityHint("Shows who on the roster is free for this practice")
    .sheet(isPresented: $showing) {
      PracticeFreeView(setId: setId, practice: practice)
    }
  }
}

/// Who of the set's roster is free for one practice — fetched when opened,
/// never when the set opens, like the web.
struct PracticeFreeView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let setId: String
  let practice: ApiPractice

  @State private var people: [PracticeAvailability.Person]?
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Group {
        if let people {
          if people.isEmpty {
            ContentUnavailableView("Nobody on the roster yet", systemImage: "person.2.slash")
          } else {
            List {
              let free = people.filter(\.free)
              let busy = people.filter { !$0.free }
              Section("Free · \(free.count)") {
                ForEach(free) { PersonRow(person: $0) }
              }
              if !busy.isEmpty {
                Section {
                  ForEach(busy) { PersonRow(person: $0) }
                } header: {
                  Text("Busy · \(busy.count)")
                } footer: {
                  Text("Busy means their availability blocks this time.")
                }
              }
            }
            .listStyle(.insetGrouped)
          }
        } else if let error {
          ContentUnavailableView {
            Label("Couldn't load", systemImage: "wifi.exclamationmark")
          } description: {
            Text(error)
          } actions: {
            Button("Try again") { Task { await load() } }
          }
        } else {
          ProgressView()
        }
      }
      .navigationTitle(practice.startsAt.formatted(.dateTime.weekday(.abbreviated).month().day().hour().minute()))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }
        }
      }
      .task { await load() }
    }
    .presentationDetents([.medium, .large])
  }

  private func load() async {
    error = nil
    do {
      people = try await model.api.practiceAvailability(setId: setId, practiceId: practice.id).sorted
    } catch {
      self.error = model.handle(error)
    }
  }

  private struct PersonRow: View {
    let person: PracticeAvailability.Person
    var body: some View {
      HStack {
        Image(systemName: person.free ? "checkmark.circle.fill" : "xmark.circle.fill")
          .foregroundStyle(person.free ? .green : .red)
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 2) {
          Text(person.name)
          if !person.roles.isEmpty {
            Text(person.roles.map { RoleLabels.label(for: $0) }.joined(separator: ", "))
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
        }
      }
      .accessibilityElement(children: .combine)
      .accessibilityValue(person.free ? "Free" : "Busy")
    }
  }
}

/// What goes on the calendar event: the set's own fields, prefilled into
/// iOS's event editor. The person picks the calendar and taps Add, so the app
/// never needs calendar permission (iOS 17 runs this editor out of process).
struct CalendarEventDraft: Identifiable {
  let id = UUID()
  let title: String
  let startsAt: Date
  let endsAt: Date
  let notes: String?
}

/// "Add to Calendar" for a toolbar.
struct AddToCalendarButton: View {
  let draft: () -> CalendarEventDraft
  @State private var showing: CalendarEventDraft?

  var body: some View {
    Button {
      showing = draft()
    } label: {
      Label("Add to Calendar", systemImage: "calendar.badge.plus")
    }
    .sheet(item: $showing) { draft in
      EventEditor(draft: draft).ignoresSafeArea()
    }
  }
}

/// iOS's own "New Event" screen, prefilled.
struct EventEditor: UIViewControllerRepresentable {
  let draft: CalendarEventDraft
  @Environment(\.dismiss) private var dismiss

  func makeUIViewController(context: Context) -> EKEventEditViewController {
    let store = EKEventStore()
    let event = EKEvent(eventStore: store)
    event.title = draft.title
    event.startDate = draft.startsAt
    event.endDate = draft.endsAt
    event.notes = draft.notes
    let editor = EKEventEditViewController()
    editor.eventStore = store
    editor.event = event
    editor.editViewDelegate = context.coordinator
    return editor
  }

  func updateUIViewController(_ controller: EKEventEditViewController, context: Context) {}

  func makeCoordinator() -> Coordinator { Coordinator(dismiss: dismiss) }

  final class Coordinator: NSObject, EKEventEditViewDelegate {
    let dismiss: DismissAction
    init(dismiss: DismissAction) { self.dismiss = dismiss }
    func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
      dismiss()
    }
  }
}

extension CalendarEventDraft {
  /// A calendar-page set: title, time, and the roster as the event's notes.
  init(set: ApiSet) {
    let roster = SetCalendar.roster(set).compactMap { row -> String? in
      guard !row.people.isEmpty else { return nil }
      return "\(row.label): \(row.people.map(\.user.name).joined(separator: ", "))"
    }
    let parts = [set.notes, roster.isEmpty ? nil : roster.joined(separator: "\n")].compactMap { $0 }.filter { !$0.isEmpty }
    self.init(
      title: set.label ?? "Worship set",
      startsAt: set.startsAt,
      endsAt: set.endsAt,
      notes: parts.isEmpty ? nil : parts.joined(separator: "\n\n")
    )
  }

  /// A My Sets set: title, time, and my roles on it.
  init(group: MySets.SetGroup) {
    let roles = group.seats.map { RoleLabels.label(for: $0.role) }.joined(separator: ", ")
    let parts = ["Playing: \(roles)", group.set.notes].compactMap { $0 }.filter { !$0.isEmpty }
    self.init(
      title: group.set.label ?? "Worship set",
      startsAt: group.set.startsAt,
      endsAt: group.set.endsAt,
      notes: parts.joined(separator: "\n\n")
    )
  }
}
