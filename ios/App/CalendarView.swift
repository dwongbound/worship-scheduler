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

  enum Phase: Equatable { case loading, loaded, failed(String) }

  private var calendar: Calendar { .current }
  private var monthKey: String { SetCalendar.ymd(month, calendar: calendar) }
  private var sets: [ApiSet] { loaded[monthKey] ?? [] }
  private var byDay: [String: [ApiSet]] { SetCalendar.byDay(sets, calendar: calendar) }
  private var allSets: [ApiSet] { loaded.values.flatMap { $0 } }
  private var myID: String? { model.session?.user.id }

  var body: some View {
    NavigationStack {
      List {
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
      .listStyle(.insetGrouped)
      .navigationTitle("Calendar")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Today") { goToToday() }
        }
      }
      .navigationDestination(for: SetLink.self) { link in
        SetDetailView(set: allSets.first { $0.id == link.id })
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

  private func dayCell(_ date: Date) -> some View {
    let ymd = SetCalendar.ymd(date, calendar: calendar)
    let daySets = byDay[ymd] ?? []
    let mine = daySets.contains { !SetCalendar.seats(of: myID, on: $0).isEmpty }
    return Button {
      selected = ymd
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
      case .loading where loaded[monthKey] == nil:
        HStack {
          ProgressView()
          Text("Loading sets").foregroundStyle(.secondary)
        }
        .frame(minHeight: 44)
      case .failed(let message) where loaded[monthKey] == nil:
        VStack(alignment: .leading, spacing: 8) {
          Label("Couldn't load sets", systemImage: "wifi.exclamationmark")
            .font(.headline)
          Text(message).foregroundStyle(.secondary)
          Button("Try Again") { Task { await load() } }
            .buttonStyle(.borderedProminent)
        }
        .padding(.vertical, 4)
      default:
        if daySets.isEmpty {
          Text("No sets this day")
            .foregroundStyle(.secondary)
            .frame(minHeight: 44)
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
      loaded[key] = fresh
      phase = .loaded
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
    .font(.footnote)
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

  var body: some View {
    let status = SetCalendar.status(set)
    VStack(alignment: .leading, spacing: 4) {
      Text(set.label ?? "Set")
        .font(.headline)
      Text("\(set.startsAt.formatted(date: .omitted, time: .shortened)) – \(set.endsAt.formatted(date: .omitted, time: .shortened))")
        .font(.subheadline)
      if let place = [set.team?.name, set.org?.name].compactMap({ $0 }).first {
        Text(place)
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      HStack(spacing: 6) {
        Circle().fill(SetStatusStyle.color(status)).frame(width: 8, height: 8)
        Text(status.label)
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      if !mySeats.isEmpty {
        Text("You: \(mySeats.map { RoleLabels.label(for: $0.role, in: set.team?.roles) }.joined(separator: ", "))")
          .font(.footnote.weight(.medium))
          .foregroundStyle(.tint)
      }
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }
}

/// One set in full: when, who's on it and what's still open, the songs, the
/// notes, the practices.
struct SetDetailView: View {
  let set: ApiSet?

  var body: some View {
    if let set {
      List {
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

        Section("Roster") {
          let rows = SetCalendar.roster(set)
          if rows.isEmpty {
            Text("No roles on this set yet").foregroundStyle(.secondary)
          }
          ForEach(rows) { row in
            RosterRowView(row: row, set: set)
          }
        }

        if let songs = set.songs, !songs.isEmpty {
          Section("Songs") {
            ForEach(songs.sorted { $0.order < $1.order }) { song in
              LabeledContent(song.title, value: song.key ?? "")
            }
          }
        }

        if let practices = set.practices, !practices.isEmpty {
          Section("Practices") {
            ForEach(practices.sorted { $0.startsAt < $1.startsAt }) { practice in
              VStack(alignment: .leading, spacing: 2) {
                Text(practice.startsAt, format: .dateTime.weekday(.wide).month().day())
                Text("\(practice.startsAt.formatted(date: .omitted, time: .shortened)) – \(practice.endsAt.formatted(date: .omitted, time: .shortened))")
                  .font(.subheadline)
                  .foregroundStyle(.secondary)
              }
              .accessibilityElement(children: .combine)
            }
          }
        }

        if let notes = set.notes, !notes.isEmpty {
          Section("Notes") { Text(notes) }
        }
      }
      .listStyle(.insetGrouped)
      .navigationTitle(set.label ?? "Set")
      .navigationBarTitleDisplayMode(.inline)
    } else {
      ContentUnavailableView("This set is no longer on the calendar", systemImage: "calendar.badge.minus")
    }
  }
}

struct RosterRowView: View {
  let row: SetCalendar.RosterRow
  let set: ApiSet

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline) {
        Text(row.label).font(.subheadline.weight(.semibold))
        if let guest = row.guestTeam {
          Text(guest)
            .font(.caption)
            .foregroundStyle(.secondary)
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
          .font(.footnote)
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
}
