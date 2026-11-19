import SwiftUI
import TapWorshipKit

/// Every set in my orgs, by month: the web's Calendar tab, for reading. Tap a
/// day for its sets, a set for its roster. Changing a roster stays on the
/// web, where Auto schedule and the staged edits live.
struct CalendarView: View {
  @Environment(AppModel.self) private var model

  @State private var month = SetCalendar.monthStart(Date(), calendar: .current)
  @State private var selected = SetCalendar.ymd(Date(), calendar: .current)
  /// Sets by month, so flipping back to a month shows it at once while the
  /// refresh runs behind it.
  @State private var loaded: [String: [ApiSet]] = [:]
  @State private var phase: Phase = .loading
  @State private var creatingSet = false

  enum Phase: Equatable { case loading, loaded, failed(String) }

  private var calendar: Calendar { .current }
  private var monthKey: String { SetCalendar.ymd(month, calendar: calendar) }
  private var sets: [ApiSet] { loaded[monthKey] ?? [] }
  private var byDay: [String: [ApiSet]] { SetCalendar.byDay(sets, calendar: calendar) }
  private var allSets: [ApiSet] { loaded.values.flatMap { $0 } }
  private var myID: String? { model.session?.user.id }

  var body: some View {
    NavigationStack {
      Group {
        if phase == .loading && loaded[monthKey] == nil {
          // Nothing of this month is known yet: the whole page as a
          // skeleton, so the grid's dots and the day's sets arrive together
          // instead of popping in one after the other.
          List { Group {
            Section {
              MonthGrid(month: .constant(month), calendar: calendar) { date in
                DayNumber(date: date, calendar: calendar).frame(maxWidth: .infinity, minHeight: 44)
              }
              .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
            }
            Section {
              ForEach(0..<2, id: \.self) { _ in
                CalendarSetRow.placeholder
              }
            }
          }
          .listRowBackground(Color.twCard)
          }
          .listStyle(.insetGrouped)
          .twList()
          .skeleton("Loading the calendar")
        } else {
          loadedList.loadedContent()
        }
      }
      .animation(.easeInOut(duration: 0.35), value: phase == .loading && loaded[monthKey] == nil)
      .pageHeader("Calendar") {
        Button("Today") { goToToday() }
        if model.isAdminAnywhere && !model.readOnly {
          HeaderIconButton(label: "New set", systemImage: "plus") { creatingSet = true }
        }
      }
      .sheet(isPresented: $creatingSet) {
        NewSetSheet(day: SetCalendar.date(ymd: selected, calendar: calendar) ?? Date(), created: load)
      }
      .navigationDestination(for: SetLink.self) { link in
        SetDetailView(set: allSets.first { $0.id == link.id }, reload: load)
          .pausesTabSwipe()
      }
      .refreshable { await load() }
      .task(id: monthKey) { await load() }
      .onChange(of: monthKey) { _, key in
        // The day under the grid follows the month: today when it's this
        // month, otherwise the 1st.
        guard !selected.hasPrefix(String(key.prefix(7))) else { return }
        let today = SetCalendar.ymd(Date(), calendar: calendar)
        selected = today.hasPrefix(String(key.prefix(7))) ? today : key
      }
    }
  }

  private var loadedList: some View {
      List { Group {
        Section {
          MonthGrid(month: $month, calendar: calendar) { date in
            dayCell(date)
          }
          .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
        } footer: {
          CalendarLegend()
        }
        daySection
      }
.listRowBackground(Color.twCard)
}
      .listStyle(.insetGrouped)
      .twList()
  }

  private func dayCell(_ date: Date) -> some View {
    let ymd = SetCalendar.ymd(date, calendar: calendar)
    let daySets = byDay[ymd] ?? []
    let mine = daySets.contains { !SetCalendar.seats(of: myID, on: $0).isEmpty }
    return Button {
      withAnimation(.snappy(duration: 0.25)) { selected = ymd }
    } label: {
      VStack(spacing: 2) {
        DayNumber(date: date, calendar: calendar, isToday: calendar.isDateInToday(date), isSelected: selected == ymd)
        HStack(spacing: 3) {
          ForEach(daySets.prefix(3)) { set in
            Circle()
              .fill(SetStatusStyle.color(SetCalendar.status(set)))
              .frame(width: 6, height: 6)
          }
        }
        .frame(height: 6)
      }
      .frame(maxWidth: .infinity, minHeight: 44)
      .background {
        if mine && selected != ymd {
          RoundedRectangle(cornerRadius: 8).fill(Color.accentColor.opacity(0.12))
        }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(dayLabel(date, sets: daySets, mine: mine))
    .accessibilityAddTraits(selected == ymd ? .isSelected : [])
  }

  private func dayLabel(_ date: Date, sets: [ApiSet], mine: Bool) -> String {
    let day = date.formatted(.dateTime.weekday(.wide).month(.wide).day())
    if sets.isEmpty { return "\(day), no sets" }
    let count = sets.count == 1 ? "1 set" : "\(sets.count) sets"
    return mine ? "\(day), \(count), you're on one" : "\(day), \(count)"
  }

  @ViewBuilder private var daySection: some View {
    let daySets = byDay[selected] ?? []
    Section {
      switch phase {
      case .failed(let message) where loaded[monthKey] == nil:
        VStack(alignment: .leading, spacing: 8) {
          Label("Couldn't load sets", systemImage: "wifi.exclamationmark")
            .font(TW.headline)
          Text(message).foregroundStyle(.secondary)
          Button("Try Again") { Task { await load() } }
            .buttonStyle(.borderedProminent)
        }
        .padding(.vertical, 4)
      default:
        if daySets.isEmpty {
          Text("No sets this day")
            .foregroundStyle(.secondary)
        } else {
          ForEach(daySets) { set in
            NavigationLink(value: SetLink(id: set.id)) {
              CalendarSetRow(set: set, mySeats: SetCalendar.seats(of: myID, on: set))
            }
          }
        }
      }
    } header: {
      if let date = SetCalendar.date(ymd: selected, calendar: calendar) {
        Text(date, format: .dateTime.weekday(.wide).month(.wide).day())
      }
    }
  }

  private func goToToday() {
    let today = Date()
    withAnimation(.smooth(duration: 0.25)) {
      month = SetCalendar.monthStart(today, calendar: calendar)
      selected = SetCalendar.ymd(today, calendar: calendar)
    }
  }

  private func load() async {
    let key = monthKey
    let start = SetCalendar.monthStart(month, calendar: calendar)
    guard let end = calendar.date(byAdding: DateComponents(month: 1, day: -1), to: start) else { return }
    if loaded[key] == nil { phase = .loading }
    do {
      let fresh = try await model.api.sets(from: start, to: end, calendar: calendar)
      withAnimation(.easeInOut(duration: 0.35)) {
        loaded[key] = fresh
        phase = .loaded
      }
      // The months either side, quietly, so flipping to them is instant.
      for step in [-1, 1] {
        guard let other = calendar.date(byAdding: .month, value: step, to: start) else { continue }
        let otherKey = SetCalendar.ymd(other, calendar: calendar)
        guard loaded[otherKey] == nil,
              let otherEnd = calendar.date(byAdding: DateComponents(month: 1, day: -1), to: other),
              let sets = try? await model.api.sets(from: other, to: otherEnd, calendar: calendar)
        else { continue }
        loaded[otherKey] = sets
      }
    } catch is CancellationError {
      // The month changed mid-load; the new month's own load is running.
    } catch {
      if let message = model.handle(error), key == monthKey { phase = .failed(message) }
    }
  }
}

/// A set's id as a navigation value. Its own type so it can't collide with
/// another screen's String destinations.
struct SetLink: Hashable {
  let id: String
}

enum SetStatusStyle {
  /// The web's StatusDot colours.
  static func color(_ status: SetCalendar.Status) -> Color {
    switch status {
    case .cover, .understaffed: .red
    case .unconfirmed: .orange
    case .confirmed: .green
    }
  }
}

struct CalendarLegend: View {
  var body: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 12) { items }
      VStack(alignment: .leading, spacing: 4) { items }
    }
    .font(TW.footnote)
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder private var items: some View {
    legend(.green, "Confirmed")
    legend(.orange, "Waiting")
    legend(.red, "Needs people or cover")
  }

  private func legend(_ color: Color, _ text: String) -> some View {
    HStack(spacing: 4) {
      Circle().fill(color).frame(width: 6, height: 6)
      Text(text)
    }
  }
}

struct CalendarSetRow: View {
  let set: ApiSet
  let mySeats: [ApiAssignment]

  /// The row's shape, for the loading skeleton.
  static var placeholder: some View {
    HStack(alignment: .top, spacing: 12) {
      RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.twAccentSoft).frame(width: 52, height: 52)
      VStack(alignment: .leading, spacing: 6) {
        Text("Sunday Morning Worship").font(TW.headline)
        Text("9:00 AM – 10:30 AM · Confirmed").font(TW.subheadline)
        Text("Sunday Team").font(TW.caption)
      }
    }
    .padding(.vertical, 6)
  }

  var body: some View {
    let status = SetCalendar.status(set)
    HStack(alignment: .top, spacing: 12) {
      // The time, where My Sets has the date: the day is already chosen.
      VStack(spacing: 0) {
        Text(set.startsAt.formatted(.dateTime.hour(.defaultDigits(amPM: .omitted)).minute()))
          .font(TW.headline)
          .monospacedDigit()
        Text(set.startsAt.formatted(.dateTime.hour(.defaultDigits(amPM: .abbreviated))).filter(\.isLetter))
          .font(TW.caption2.weight(.bold))
          .foregroundStyle(Color.accentColor)
      }
      .frame(width: 52, height: 52)
      .background(Color.twAccentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .accessibilityHidden(true)

      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 6) {
          Circle().fill(SetStatusStyle.color(status)).frame(width: 8, height: 8)
          Text(set.label ?? "Worship Set")
            .font(TW.headline)
        }
        Text("\(set.startsAt.formatted(date: .omitted, time: .shortened)) – \(set.endsAt.formatted(date: .omitted, time: .shortened)) · \(status.label)")
          .font(TW.subheadline)
          .foregroundStyle(.secondary)
        FlowLayout(spacing: 6) {
          if let team = set.team?.name { TeamPill(text: team) }
          ForEach(mySeats, id: \.id) { seat in
            RoleChip(text: "You · \(RoleLabels.label(for: seat.role, in: set.team?.roles))")
          }
        }
      }
    }
    .padding(.vertical, 6)
    .accessibilityElement(children: .combine)
  }
}

/// One set in full: when, who's on it and what's still open, the songs, the
/// notes, the practices.
struct SetDetailView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let set: ApiSet?
  /// Refetches the calendar after an edit, so this page shows the saved set.
  var reload: () async -> Void = {}

  @State private var editingSetlist = false
  @State private var editingRoster = false
  @State private var addingPractice = false
  @State private var deletingPractice: ApiPractice?
  @State private var confirmDelete = false
  @State private var working = false
  @State private var actionError: String?

  var body: some View {
    if let set {
      // Everything below that writes is an admin's, so a read-only preview
      // simply doesn't count anyone as one here.
      let isAdmin = model.isAdmin(of: set.org?.id) && !model.readOnly
      List { Group {
        Section {
          LabeledContent("Date", value: set.startsAt.formatted(.dateTime.weekday(.wide).month(.wide).day()))
          LabeledContent("Time", value: "\(set.startsAt.formatted(date: .omitted, time: .shortened)) – \(set.endsAt.formatted(date: .omitted, time: .shortened))")
          if let team = set.team?.name { LabeledContent("Team", value: team) }
          if let org = set.org?.name { LabeledContent("Org", value: org) }
          HStack(spacing: 6) {
            Circle().fill(SetStatusStyle.color(SetCalendar.status(set))).frame(width: 8, height: 8)
            Text(SetCalendar.status(set).label)
          }
          .accessibilityElement(children: .combine)
        }

        Section {
          let rows = SetCalendar.roster(set)
          if rows.isEmpty {
            Text("No roles on this set yet").foregroundStyle(.secondary)
          }
          ForEach(rows) { row in
            RosterRowView(row: row, set: set)
          }
        } header: {
          SectionHeader(title: "Roster", action: isAdmin ? ("Edit", { editingRoster = true }) : nil)
        }

        let songs = (set.songs ?? []).sorted { $0.order < $1.order }
        let canEditSongs = !model.readOnly && Setlist.canEdit(set, userId: model.session?.user.id, isOrgAdmin: isAdmin)
        if !songs.isEmpty || canEditSongs {
          Section {
            if songs.isEmpty {
              Text("No songs yet").foregroundStyle(.secondary)
            }
            ForEach(songs) { song in
              LabeledContent(song.title, value: song.key ?? "")
            }
          } header: {
            SectionHeader(title: "Songs", action: canEditSongs ? ("Edit", { editingSetlist = true }) : nil)
          }
        }

        let practices = (set.practices ?? []).sorted { $0.startsAt < $1.startsAt }
        if !practices.isEmpty || isAdmin {
          Section {
            ForEach(practices) { practice in
              PracticeRow(setId: set.id, practice: practice)
                .swipeActions {
                  if isAdmin {
                    Button("Delete", role: .destructive) { deletingPractice = practice }
                  }
                }
            }
            if isAdmin {
              Button {
                addingPractice = true
              } label: {
                Label("Add practice", systemImage: "plus")
              }
            }
          } header: {
            Text("Practices")
          } footer: {
            if isAdmin && !practices.isEmpty {
              Text("Swipe left on a practice to cancel it.")
            }
          }
        }

        SetNotesSection(
          setId: set.id,
          currentNotes: set.notes,
          canPost: !model.readOnly && SetNotes.canPost(on: set, userId: model.session?.user.id, isOrgAdmin: isAdmin)
        )

        if isAdmin {
          Section {
            Button("Delete set", role: .destructive) { confirmDelete = true }
              .disabled(working)
              // On the button, so the dialog points at it rather than the list.
              .confirmationDialog("Delete this set?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete set", role: .destructive) {
                  Task {
                    await run { try await model.api.deleteSet(set.id) }
                    if actionError == nil { dismiss() }
                  }
                }
              } message: {
                Text("Its roster, songs, notes and practices go too, and calendar invites are cancelled. This can't be undone.")
              }
          } footer: {
            if let actionError {
              Label(actionError, systemImage: "exclamationmark.circle").foregroundStyle(.red)
            }
          }
        }
      }
.listRowBackground(Color.twCard)
}
      .listStyle(.insetGrouped)
      .twList()
      .navigationTitle(set.label ?? "Set")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .primaryAction) {
          AddToCalendarButton { CalendarEventDraft(set: set) }
        }
      }
      .sheet(isPresented: $editingSetlist) { SetlistEditorSheet(set: set, saved: reload) }
      .sheet(isPresented: $editingRoster) { RosterEditorSheet(set: set, saved: reload) }
      .sheet(isPresented: $addingPractice) { AddPracticeSheet(set: set, saved: reload) }
      .confirmationDialog(
        "Cancel this practice?",
        isPresented: Binding(get: { deletingPractice != nil }, set: { if !$0 { deletingPractice = nil } }),
        titleVisibility: .visible,
        presenting: deletingPractice
      ) { practice in
        Button("Cancel practice", role: .destructive) {
          Task { await run { try await model.api.deletePractice(setId: set.id, practiceId: practice.id) } }
        }
      } message: { _ in
        Text("Everyone on the set gets a calendar cancellation.")
      }
    } else {
      BrandedEmpty(title: "This set is no longer on the calendar", systemImage: "calendar.badge.minus")
    }
  }

  private func run(_ action: () async throws -> Void) async {
    working = true
    actionError = nil
    do {
      try await action()
      await reload()
    } catch {
      actionError = model.handle(error)
    }
    working = false
  }
}

/// A section title with an optional button on the right ("Edit").
struct SectionHeader: View {
  let title: String
  var action: (String, () -> Void)?

  var body: some View {
    HStack {
      Text(title)
      Spacer()
      if let action {
        Button(action.0, action: action.1)
          .font(TW.subheadline.weight(.semibold))
          .textCase(nil)
      }
    }
  }
}

struct RosterRowView: View {
  let row: SetCalendar.RosterRow
  let set: ApiSet

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      // The role is a small secondary label above the names (like Contacts'
      // "mobile" above a number), so role and person never read as one line.
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text(row.label)
          .font(TW.caption.weight(.semibold))
          .textCase(.uppercase)
          .foregroundStyle(.secondary)
        if let guest = row.guestTeam {
          Text("· \(guest)")
            .font(TW.caption)
            .foregroundStyle(.tertiary)
        }
      }
      ForEach(row.people) { seat in
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(SetCalendar.isMD(seat, on: set) ? "\(seat.user.name) (MD)" : seat.user.name)
          Spacer(minLength: 8)
          StatusPill(status: seat.status)
        }
      }
      if row.open > 0 {
        Text(row.open == 1 ? "1 open seat" : "\(row.open) open seats")
          .font(TW.footnote)
          .foregroundStyle(.red)
      }
    }
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
  }
}

#Preview("Calendar") {
  CalendarView()
    .environment(AppModel.fullPreview())
}

#Preview("Calendar · dark, largest text") {
  CalendarView()
    .environment(AppModel.fullPreview())
    .preferredColorScheme(.dark)
    .dynamicTypeSize(.accessibility5)
}

#Preview("Calendar · empty") {
  CalendarView()
    .environment(AppModel.fullPreview(sets: "[]"))
}

#Preview("Calendar · offline") {
  CalendarView()
    .environment(AppModel.fullPreview(failWith: URLError(.notConnectedToInternet)))
}

#Preview("Set detail") {
  NavigationStack {
    SetDetailView(set: FullPreviewData.sets.first)
  }
  .environment(AppModel.fullPreview())
}
