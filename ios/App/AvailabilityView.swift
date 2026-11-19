import SwiftUI
import TapWorshipKit

/// When I can't serve: the web's /schedule, called Unavailabilities here.
/// Tap a day to open its drawer (what's blocked, and block or free it);
/// weekly blocks and part-day blocks live in their own lists underneath; an
/// open request from an admin sits on top until it's submitted.
///
/// Days are read on the app's clock (`AppConfig.appCalendar`), not the
/// phone's: that's the clock the scheduler judges them on.
struct AvailabilityView: View {
  @Environment(AppModel.self) private var model

  @State private var data = ApiAvailability.empty
  @State private var phase: Phase = .loading
  @State private var month = SetCalendar.monthStart(Date(), calendar: AppConfig.appCalendar)
  @State private var actionError: String?
  /// Writes still on their way. A reload that lands while one is in flight
  /// would undo what the grid just showed, so it waits for the last one.
  @State private var inFlight = 0
  @State private var taps = 0
  @State private var adding = false
  @State private var submitting: ApiAvailabilityRequest?
  @State private var busyRequest: String?
  /// The day whose drawer is open.
  @State private var openDay: OpenDay?

  struct OpenDay: Identifiable { let ymd: String; let date: Date; var id: String { ymd } }

  enum Phase: Equatable { case loading, loaded, failed(String) }

  private var calendar: Calendar { AppConfig.appCalendar }
  private var today: String { SetCalendar.ymd(Date(), calendar: calendar) }

  var body: some View {
    NavigationStack {
      content
        .animation(.smooth(duration: 0.3), value: phase)
        .pageHeader("Unavailabilities") {
          if !model.readOnly {
            HeaderIconButton(label: "Add a block", systemImage: "plus") { adding = true }
              .disabled(phase != .loaded)
          }
        }
        .refreshable { await load() }
        .task { if phase == .loading { await load() } }
        .sheet(isPresented: $adding) {
          AddBlockSheet { await write($0) }
        }
        .sheet(item: $openDay) { day in
          DayDrawer(
            date: day.date,
            blocks: Availability.dayDetails(data.entries, on: day.ymd, calendar: calendar),
            canBlockAllDay: Availability.tapBlocks(data.entries, on: day.ymd, calendar: calendar),
            readOnly: model.readOnly,
            onBlockAllDay: { setDay(day.ymd, blocked: true) },
            onFree: { setDay(day.ymd, blocked: false) },
            onAddTime: { start, end in
              await write { try await model.api.addTimed(date: day.ymd, startMinute: start, endMinute: end) }
            }
          )
        }
        .sheet(item: $submitting) { request in
          SubmitAvailabilitySheet(
            request: request,
            blocked: Availability.blockedDays(data.entries, from: request.startDate, to: request.endDate, calendar: calendar),
            note: data.responses.first { $0.requestId == request.id }?.note ?? ""
          ) { note in
            await toggle(request, note: note)
          }
        }
        .alert("Couldn't save that", isPresented: Binding(
          get: { actionError != nil },
          set: { if !$0 { actionError = nil } }
        ), actions: {
          Button("OK") { actionError = nil }
        }, message: { Text(actionError ?? "") })
        .sensoryFeedback(.selection, trigger: taps)
    }
  }

  @ViewBuilder private var content: some View {
    switch phase {
    case .loading:
      List { Group {
        Section {
          MonthGrid(month: .constant(month), calendar: calendar) { date in
            DayNumber(date: date, calendar: calendar).frame(maxWidth: .infinity, minHeight: 44)
          }
        }
      }
.listRowBackground(Color.twCard)
}
      .skeleton("Loading your availability")
    case .failed(let message):
      BrandedEmpty(title: "Couldn't load your availability", systemImage: "wifi.exclamationmark", message: message) {
        Button("Try Again") { Task { await load() } }
          .buttonStyle(.borderedProminent)
      }
    case .loaded:
      list.loadedContent()
    }
  }

  private var list: some View {
    List { Group {
      requestsSection

      Section {
        MonthGrid(month: $month, calendar: calendar) { date in
          dayCell(date)
        }
        .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
      } footer: {
        VStack(alignment: .leading, spacing: 6) {
          Text("Tap a day to see what's blocked, and to block or free it.")
          AvailabilityLegend()
        }
      }

      weeklySection
      timedSection
    }
.listRowBackground(Color.twCard)
}
    .listStyle(.insetGrouped)
    .twList()
  }

  // MARK: Requests

  @ViewBuilder private var requestsSection: some View {
    let requests = Availability.activeRequests(data.requests)
    if !requests.isEmpty {
      Section {
        ForEach(requests) { request in
          let done = Availability.isSubmitted(request, responses: data.responses)
          // One compact row: what was asked, and a small button on the right.
          HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
              HStack(spacing: 6) {
                Text(request.name ?? "Availability request")
                  .font(TW.headline)
                if done {
                  Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .accessibilityLabel("Submitted")
                    .transition(.scale.combined(with: .opacity))
                }
              }
              Text([
                "\(dayText(request.startDate)) – \(dayText(request.endDate))",
                request.org?.name,
              ].compactMap { $0 }.joined(separator: " · "))
                .font(TW.subheadline)
                .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 0)
            if !model.readOnly {
              if done {
                Button {
                  Task { await toggle(request, note: nil) }
                } label: {
                  compactBusyLabel("Edit", busy: busyRequest == request.id)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .buttonBorderShape(.capsule)
              } else {
                Button {
                  submitting = request
                } label: {
                  Text("Submit")
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .buttonBorderShape(.capsule)
              }
            }
          }
          .disabled(busyRequest != nil)
          .animation(.smooth, value: done)
        }
      } header: {
        Text("Asked for")
      } footer: {
        Text(model.readOnly
             ? "Read-only preview: block days and submit on tapworship.com."
             : "Block the days you can't serve, then Submit so your admin knows you're done. Edit reopens it.")
      }
    }
  }

  /// A small button's word with a spinner laid over it, same width either way.
  private func compactBusyLabel(_ title: String, busy: Bool) -> some View {
    ZStack {
      Text(title).opacity(busy ? 0 : 1)
      if busy { ProgressView().controlSize(.mini).accessibilityLabel("Saving") }
    }
  }

  // MARK: Grid

  private func dayCell(_ date: Date) -> some View {
    let ymd = SetCalendar.ymd(date, calendar: calendar)
    let level = Availability.level(data.entries, on: ymd, calendar: calendar)
    let repeating = Availability.isRepeating(data.entries, on: ymd, calendar: calendar)
    let past = ymd < today
    return Button {
      // A swipe between tabs ending over the grid isn't a tap on a day.
      guard !model.justSwiped else { return }
      taps += 1
      openDay = OpenDay(ymd: ymd, date: date)
    } label: {
      VStack(spacing: 2) {
        Text("\(calendar.component(.day, from: date))")
          .font(TW.body.weight(ymd == today ? .bold : .regular))
          .monospacedDigit()
          .foregroundStyle(level == .full ? Color.white : Color.primary)
          .frame(width: 32, height: 32)
          .background {
            switch level {
            case .full: Circle().fill(Color.red)
            case .partial: Circle().strokeBorder(Color.orange, lineWidth: 2)
            case nil: if ymd == today { Circle().strokeBorder(Color.accentColor, lineWidth: 1) }
            }
          }
        Image(systemName: "repeat")
          .font(.system(size: 8, weight: .bold))
          .foregroundStyle(.secondary)
          .opacity(repeating ? 1 : 0)
          .frame(height: 8)
          .accessibilityHidden(true)
      }
      .frame(maxWidth: .infinity, minHeight: 44)
      .contentShape(Rectangle())
      .opacity(past ? 0.4 : 1)
    }
    .buttonStyle(.plain)
    .disabled(past)
    .contextMenu {
      if !past && !model.readOnly {
        if level != .full || Availability.tapBlocks(data.entries, on: ymd, calendar: calendar) {
          Button { setDay(ymd, blocked: true) } label: { Label("Block all day", systemImage: "nosign") }
        }
        if level != nil {
          Button { setDay(ymd, blocked: false) } label: { Label("Free this day", systemImage: "checkmark.circle") }
        }
      }
    }
    .accessibilityLabel(dayLabel(date, level: level, repeating: repeating))
    .accessibilityHint(past ? "" : "Shows this day's details")
  }

  private func dayLabel(_ date: Date, level: Availability.Level?, repeating: Bool) -> String {
    var style = Date.FormatStyle.dateTime.weekday(.wide).month(.wide).day()
    style.timeZone = calendar.timeZone
    let state: String
    switch level {
    case .full: state = "blocked all day"
    case .partial: state = "partly blocked"
    case nil: state = "free"
    }
    return "\(date.formatted(style)), \(state)\(repeating ? ", repeats weekly" : "")"
  }

  /// Shows the change at once, then lets the server have the last word.
  private func setDay(_ ymd: String, blocked: Bool) {
    taps += 1
    withAnimation(.smooth(duration: 0.2)) {
      data = ApiAvailability(
        entries: Availability.applyingTap(data.entries, on: ymd, block: blocked, calendar: calendar),
        requests: data.requests,
        responses: data.responses
      )
    }
    Task { await write { try await model.api.blockDays(start: ymd, end: ymd, blocked: blocked) } }
  }

  // MARK: Lists

  @ViewBuilder private var weeklySection: some View {
    let rules = Availability.weeklyRules(data.entries)
    Section {
      if rules.isEmpty {
        Text("Nothing repeats yet")
          .foregroundStyle(.secondary)
      }
      ForEach(rules) { rule in
        VStack(alignment: .leading, spacing: 2) {
          Text(Availability.weeklyTitle(rule))
          Text(weeklyDetail(rule))
            .font(TW.subheadline)
            .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .swipeActions(edge: .trailing) {
          if !model.readOnly {
            Button("Delete", role: .destructive) { delete(rule) }
          }
        }
        .ownsSideSwipe(!model.readOnly)
      }
    } header: {
      Text("Every week")
    } footer: {
      if !rules.isEmpty && !model.readOnly { Text("Swipe left on a block to delete it.") }
    }
  }

  private func weeklyDetail(_ rule: ApiUnavailability) -> String {
    var parts = [Availability.windowLabel(rule)]
    if let start = rule.startDate { parts.append("from \(dayText(start))") }
    if let end = rule.endDate { parts.append("until \(dayText(end))") }
    let skipped = (rule.exceptDates ?? []).filter { $0 >= today }.count
    if skipped > 0 { parts.append(skipped == 1 ? "1 day freed" : "\(skipped) days freed") }
    return parts.joined(separator: " · ")
  }

  @ViewBuilder private var timedSection: some View {
    let blocks = Availability.timedBlocks(data.entries, now: Date(), calendar: calendar)
    if !blocks.isEmpty {
      Section("Part of a day") {
        ForEach(blocks) { block in
          VStack(alignment: .leading, spacing: 2) {
            Text(timedTitle(block))
            Text(block.fromGoogle == true ? "\(Availability.windowLabel(block)) · from Google Calendar" : Availability.windowLabel(block))
              .font(TW.subheadline)
              .foregroundStyle(.secondary)
          }
          .accessibilityElement(children: .combine)
          .swipeActions(edge: .trailing) {
            if !model.readOnly {
              Button("Delete", role: .destructive) { delete(block) }
            }
          }
          .ownsSideSwipe(!model.readOnly)
        }
      }
    }
  }

  private func timedTitle(_ block: ApiUnavailability) -> String {
    guard let start = block.startDate else { return "" }
    if let end = block.endDate, SetCalendar.ymd(end, calendar: calendar) != SetCalendar.ymd(start, calendar: calendar) {
      return "\(dayText(start)) – \(dayText(end))"
    }
    return dayText(start)
  }

  /// "Tue, Nov 10", on the app's clock.
  private func dayText(_ date: Date) -> String {
    var style = Date.FormatStyle.dateTime.weekday(.abbreviated).month(.abbreviated).day()
    style.timeZone = calendar.timeZone
    return date.formatted(style)
  }

  private func delete(_ entry: ApiUnavailability) {
    withAnimation(.smooth) {
      data = ApiAvailability(entries: data.entries.filter { $0.id != entry.id }, requests: data.requests, responses: data.responses)
    }
    Task { await write { try await model.api.deleteAvailability(entry.id) } }
  }

  // MARK: Loading and saving

  private func load() async {
    do {
      let fresh = try await model.api.availability()
      // A write still on its way would be undone by this answer.
      guard inFlight == 0 else { return }
      withAnimation(.smooth(duration: 0.2)) { data = fresh }
      withAnimation(.easeInOut(duration: 0.35)) { phase = .loaded }
    } catch {
      if let message = model.handle(error), phase != .loaded { phase = .failed(message) }
    }
  }

  /// One write, then a reload once the last write in flight has answered.
  /// Returns whether it saved.
  @discardableResult
  private func write(_ action: () async throws -> Void) async -> Bool {
    inFlight += 1
    var saved = true
    do {
      try await action()
    } catch {
      saved = false
      actionError = model.handle(error)
    }
    inFlight -= 1
    if inFlight == 0 { await load() }
    return saved
  }

  private func toggle(_ request: ApiAvailabilityRequest, note: String?) async {
    busyRequest = request.id
    await write { try await model.api.toggleAvailabilityComplete(requestId: request.id, note: note) }
    busyRequest = nil
  }
}

struct AvailabilityLegend: View {
  var body: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 12) { items }
      VStack(alignment: .leading, spacing: 4) { items }
    }
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder private var items: some View {
    HStack(spacing: 4) {
      Circle().fill(Color.red).frame(width: 10, height: 10)
      Text("All day")
    }
    HStack(spacing: 4) {
      Circle().strokeBorder(Color.orange, lineWidth: 2).frame(width: 10, height: 10)
      Text("Part of the day")
    }
    HStack(spacing: 4) {
      Image(systemName: "repeat").font(TW.caption2)
      Text("Weekly")
    }
  }
}

/// The last look before submitting: a one-line count, the note for the
/// admin, then the unavailabilities themselves, folded into back-to-back runs
/// ("Thu, Nov 12 – Sat, Nov 14 · All day") and grouped by month, so a long
/// window still reads in a glance.
struct SubmitAvailabilitySheet: View {
  let request: ApiAvailabilityRequest
  let blocked: [(ymd: String, date: Date, level: Availability.Level)]
  let submit: (String) async -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var note: String
  @State private var sending = false

  init(
    request: ApiAvailabilityRequest,
    blocked: [(ymd: String, date: Date, level: Availability.Level)],
    note: String,
    submit: @escaping (String) async -> Void
  ) {
    self.request = request
    self.blocked = blocked
    self.submit = submit
    _note = State(initialValue: note)
  }

  private var calendar: Calendar { AppConfig.appCalendar }

  /// The runs, grouped under the month each one starts in.
  private var months: [(title: String, runs: [Availability.BlockedRun])] {
    var out: [(title: String, runs: [Availability.BlockedRun])] = []
    var style = Date.FormatStyle.dateTime.month(.wide).year()
    style.timeZone = calendar.timeZone
    for run in Availability.runs(blocked, calendar: calendar) {
      let title = run.first.formatted(style)
      if out.last?.title == title { out[out.count - 1].runs.append(run) } else { out.append((title, [run])) }
    }
    return out
  }

  private var summary: String {
    let full = blocked.filter { $0.level == .full }.count
    let part = blocked.count - full
    var parts: [String] = []
    if full > 0 { parts.append("\(full) all day") }
    if part > 0 { parts.append("\(part) part of the day") }
    return "\(blocked.count) \(blocked.count == 1 ? "day" : "days") · " + parts.joined(separator: ", ")
  }

  var body: some View {
    NavigationStack {
      Form { Group {
        Section {
          if blocked.isEmpty {
            Label("You're free every day in this window", systemImage: "checkmark.circle")
          } else {
            Label(summary, systemImage: "calendar.badge.exclamationmark")
          }
          TextField("Note for your admin (optional)", text: $note, axis: .vertical)
            .lineLimit(2...6)
        } header: {
          Text("\(dayText(request.startDate)) – \(dayText(request.endDate))")
        } footer: {
          if note.count > 400 {
            Text("\(note.count)/500").foregroundStyle(note.count > 500 ? .red : .secondary)
          }
        }

        ForEach(months, id: \.title) { month in
          Section(month.title) {
            ForEach(month.runs, id: \.first) { run in
              HStack {
                VStack(alignment: .leading, spacing: 2) {
                  Text(run.days == 1 ? dayText(run.first) : "\(dayText(run.first)) – \(dayText(run.last))")
                  if run.days > 1 {
                    Text("\(run.days) days").font(TW.footnote).foregroundStyle(.secondary)
                  }
                }
                Spacer()
                Text(run.level == .full ? "All day" : "Part of the day")
                  .font(TW.subheadline)
                  .foregroundStyle(run.level == .full ? .red : .orange)
              }
              .accessibilityElement(children: .combine)
            }
          }
        }

        if !blocked.isEmpty {
          Section {} footer: {
            Text("Something missing? Close this and tap the day on the calendar.")
          }
        }
      }
.listRowBackground(Color.twCard)
}.twList()
      .navigationTitle("Unavailabilities")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }
            .disabled(sending)
        }
        ToolbarItem(placement: .confirmationAction) {
          if sending {
            ProgressView()
          } else {
            Button("Submit") {
              sending = true
              Task {
                // Always sent, even blank: a blank box clears an old note.
                await submit(note.trimmingCharacters(in: .whitespacesAndNewlines))
                dismiss()
              }
            }
            .disabled(note.count > 500)
          }
        }
      }
      .interactiveDismissDisabled(sending)
    }
  }

  private func dayText(_ date: Date) -> String {
    var style = Date.FormatStyle.dateTime.weekday(.abbreviated).month(.abbreviated).day()
    style.timeZone = AppConfig.appTimeZone
    return date.formatted(style)
  }
}

/// One day, opened from the calendar: whether it's free, each block on it
/// (with where it came from), and the actions — block all day, free it, or
/// block part of it.
struct DayDrawer: View {
  let date: Date
  let blocks: [ApiUnavailability]
  let canBlockAllDay: Bool
  let readOnly: Bool
  let onBlockAllDay: () -> Void
  let onFree: () -> Void
  /// Saves a part-day block; says whether it worked.
  let onAddTime: (Int, Int) async -> Bool

  @Environment(\.dismiss) private var dismiss
  @State private var addingTime = false
  @State private var from = AddBlockSheet.time(hour: 9)
  @State private var to = AddBlockSheet.time(hour: 12)
  @State private var saving = false

  private var allDay: Bool { blocks.contains(where: \.isAllDay) }

  private var status: (text: String, icon: String, color: Color) {
    if blocks.isEmpty { return ("Free all day", "checkmark.circle.fill", .green) }
    if allDay { return ("Unavailable all day", "nosign", .red) }
    let windows = blocks.map { Availability.windowLabel($0) }.joined(separator: ", ")
    return ("Unavailable \(windows)", "clock.badge.exclamationmark", .orange)
  }

  private func source(_ block: ApiUnavailability) -> String {
    if block.type == .recurring { return Availability.weeklyTitle(block) }
    if block.fromGoogle == true { return "From Google Calendar" }
    return "Added by you"
  }

  private func minutes(_ date: Date) -> Int {
    let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
    return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
  }

  var body: some View {
    NavigationStack {
      List { Group {
        Section {
          Label(status.text, systemImage: status.icon)
            .foregroundStyle(status.color)
            .font(TW.headline)
          ForEach(blocks) { block in
            LabeledContent {
              Text(source(block))
            } label: {
              Text(Availability.windowLabel(block))
            }
          }
        }

        if !readOnly {
          Section {
            if canBlockAllDay {
              Button {
                onBlockAllDay()
                dismiss()
              } label: {
                Label("Block all day", systemImage: "nosign")
              }
            }
            if !blocks.isEmpty {
              Button(role: .destructive) {
                onFree()
                dismiss()
              } label: {
                Label("Free this day", systemImage: "checkmark.circle")
              }
            }
            if !allDay {
              Button {
                withAnimation(.smooth) { addingTime.toggle() }
              } label: {
                Label("Block part of the day", systemImage: "clock")
              }
              if addingTime {
                HStack {
                  DatePicker("From", selection: $from, displayedComponents: .hourAndMinute).labelsHidden()
                  Text("–").foregroundStyle(.secondary)
                  DatePicker("To", selection: $to, displayedComponents: .hourAndMinute).labelsHidden()
                  Spacer()
                  Button {
                    saving = true
                    Task {
                      let saved = await onAddTime(minutes(from), minutes(to))
                      saving = false
                      if saved { dismiss() }
                    }
                  } label: {
                    if saving { ProgressView() } else { Text("Add") }
                  }
                  .buttonStyle(.borderedProminent)
                  .controlSize(.small)
                  .disabled(saving || minutes(from) >= minutes(to))
                }
                .transition(.opacity)
              }
            }
          } footer: {
            if blocks.contains(where: { $0.type == .recurring }) && !blocks.isEmpty {
              Text("Freeing a day only skips it; your weekly block keeps repeating.")
            }
          }
        }
      }
.listRowBackground(Color.twCard)
}
      .listStyle(.insetGrouped)
      .twList()
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }
        }
      }
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
  }

  private var title: String {
    var style = Date.FormatStyle.dateTime.weekday(.wide).month(.abbreviated).day()
    style.timeZone = AppConfig.appTimeZone
    return date.formatted(style)
  }
}

/// A new block: one that repeats every week, or a run of dates (one day is
/// a run of one).
struct AddBlockSheet: View {
  /// Runs the save and says whether it worked; the sheet stays up if not.
  let save: (@escaping () async throws -> Void) async -> Bool

  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss

  enum Kind: String, CaseIterable, Identifiable {
    case weekly = "Every week"
    case dates = "Dates"
    var id: String { rawValue }
  }

  @State private var kind = Kind.weekly
  @State private var days: Set<Int> = []
  @State private var allDay = true
  @State private var from = AddBlockSheet.time(hour: 9)
  @State private var to = AddBlockSheet.time(hour: 17)
  @State private var ends = false
  @State private var until = Date().addingTimeInterval(28 * 86_400)
  @State private var day = Date()
  @State private var lastDay = Date()
  @State private var sending = false

  static func time(hour: Int) -> Date {
    Calendar.current.date(bySettingHour: hour, minute: 0, second: 0, of: Date()) ?? Date()
  }

  /// The pickers show the phone's clock, so that's the clock to read them on.
  private func minutes(_ date: Date) -> Int {
    let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
    return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
  }

  private var startMinute: Int { allDay ? 0 : minutes(from) }
  private var endMinute: Int { allDay ? Availability.fullDay : minutes(to) }

  private var problem: String? {
    switch kind {
    case .weekly: Availability.weeklyProblem(days: days, startMinute: startMinute, endMinute: endMinute)
    case .dates: Availability.rangeProblem(from: day, through: lastDay, startMinute: startMinute, endMinute: endMinute, calendar: .current)
    }
  }

  var body: some View {
    NavigationStack {
      Form { Group {
        Section {
          Picker("Repeats", selection: $kind.animation(.smooth)) {
            ForEach(Kind.allCases) { Text($0.rawValue).tag($0) }
          }
          .pickerStyle(.segmented)
          .listRowBackground(Color.clear)
          .listRowInsets(EdgeInsets())
        }

        Section {
          if kind == .weekly {
            // Seven days in one row, instead of a list row per day.
            WeekdayPicker(selection: $days)
              .padding(.vertical, 4)
          } else {
            DatePicker("From", selection: $day, in: Date()..., displayedComponents: .date)
            DatePicker("Through", selection: $lastDay, in: day..., displayedComponents: .date)
          }
        } header: {
          Text(kind == .weekly ? "Days" : "Dates")
        } footer: {
          if kind == .dates {
            Text("For one day, leave From and Through on the same date.")
          }
        }
        .onChange(of: day) { _, first in
          // Moving the first day past the last drags the last along.
          if lastDay < first { lastDay = first }
        }

        Section {
          Toggle("All day", isOn: $allDay.animation(.smooth))
          if !allDay {
            // One row: "9:00 AM – 5:00 PM".
            HStack {
              Text("Time")
              Spacer()
              DatePicker("From", selection: $from, displayedComponents: .hourAndMinute)
                .labelsHidden()
              Text("–").foregroundStyle(.secondary)
              DatePicker("To", selection: $to, displayedComponents: .hourAndMinute)
                .labelsHidden()
            }
            .transition(.opacity.combined(with: .move(edge: .top)))
          }
        } footer: {
          if let problem, !(kind == .weekly && days.isEmpty) {
            Text(problem).foregroundStyle(.red)
          }
        }

        if kind == .weekly {
          Section {
            Toggle("Ends on a date", isOn: $ends.animation(.smooth))
            if ends {
              DatePicker("Last day", selection: $until, in: Date()..., displayedComponents: .date)
            }
          } footer: {
            Text(ends ? "Repeats every week through that day." : "Repeats every week until you delete it.")
          }
        }
      }
.listRowBackground(Color.twCard)
}.twList()
      .navigationTitle("Add a block")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }
            .disabled(sending)
        }
        ToolbarItem(placement: .confirmationAction) {
          if sending {
            ProgressView()
          } else {
            Button("Add") { add() }
              .disabled(problem != nil)
          }
        }
      }
      .interactiveDismissDisabled(sending)
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
  }

  private func add() {
    sending = true
    let api = model.api
    let start = startMinute
    let end = endMinute
    // A day picked on the phone is the day the person saw, so it's spelled on
    // the phone's calendar.
    let dayYmd = SetCalendar.ymd(day, calendar: .current)
    let lastYmd = SetCalendar.ymd(lastDay, calendar: .current)
    let rangeYmds = Availability.ymds(from: day, through: lastDay, calendar: .current, limit: Availability.maxRangeDays)
    let untilYmd = ends ? SetCalendar.ymd(until, calendar: .current) : nil
    let blocks = days.sorted().map {
      WeeklyBlockInput(dayOfWeek: $0, startMinute: start, endMinute: end, endDate: untilYmd)
    }
    let kind = self.kind
    let allDay = self.allDay
    Task {
      let saved = await save {
        switch kind {
        case .weekly:
          try await api.addWeekly(blocks)
        case .dates:
          if allDay {
            try await api.blockDays(start: dayYmd, end: lastYmd, blocked: true)
          } else {
            // Part of each day: one block per day, like the web's form.
            for ymd in rangeYmds {
              try await api.addTimed(date: ymd, startMinute: start, endMinute: end)
            }
          }
        }
      }
      sending = false
      if saved { dismiss() }
    }
  }
}

#Preview("Availability") {
  AvailabilityView()
    .environment(AppModel.fullPreview())
}

#Preview("Availability · dark, largest text") {
  AvailabilityView()
    .environment(AppModel.fullPreview())
    .preferredColorScheme(.dark)
    .dynamicTypeSize(.accessibility5)
}

#Preview("Availability · nothing blocked") {
  AvailabilityView()
    .environment(AppModel.fullPreview(availability: #"{"entries":[],"requests":[],"responses":[]}"#))
}

#Preview("Availability · offline") {
  AvailabilityView()
    .environment(AppModel.fullPreview(failWith: URLError(.notConnectedToInternet)))
}

#Preview("Add a block") {
  AddBlockSheet { _ in true }
    .environment(AppModel.fullPreview())
}
