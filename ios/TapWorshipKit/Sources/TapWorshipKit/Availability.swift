import Foundation

// The Availability tab: GET /api/availability and the writes around it.
// Mirrors lib/availability.ts, so a day reads the same on the phone and the
// web. Every rule here takes the `Calendar` to judge days in: the server
// stores a block's dates as midnight on the APP's clock (lib/appTz.ts), so the
// app passes a calendar pinned to that zone, not the phone's.

public enum UnavailabilityType: String, Codable, Sendable {
  case recurring = "RECURRING"
  case specific = "SPECIFIC"
  /// Legacy: a run of whole days with no time window.
  case dateRange = "DATE_RANGE"
}

public struct ApiUnavailability: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let type: UnavailabilityType
  /// 0 = Sunday. Recurring rules only.
  public let dayOfWeek: Int?
  /// Minutes from midnight. nil start = 0, nil end = the whole day.
  public let startMinute: Int?
  public let endMinute: Int?
  /// A dated block's first day; on a recurring rule, the first day it repeats.
  public let startDate: Date?
  public let endDate: Date?
  /// "YYYY-MM-DD" days a recurring rule skips.
  public let exceptDates: [String]?
  public let requestId: String?
  public let fromGoogle: Bool?
  public let note: String?

  public init(
    id: String, type: UnavailabilityType, dayOfWeek: Int? = nil,
    startMinute: Int? = nil, endMinute: Int? = nil,
    startDate: Date? = nil, endDate: Date? = nil, exceptDates: [String]? = nil,
    requestId: String? = nil, fromGoogle: Bool? = nil, note: String? = nil
  ) {
    self.id = id
    self.type = type
    self.dayOfWeek = dayOfWeek
    self.startMinute = startMinute
    self.endMinute = endMinute
    self.startDate = startDate
    self.endDate = endDate
    self.exceptDates = exceptDates
    self.requestId = requestId
    self.fromGoogle = fromGoogle
    self.note = note
  }

  /// Covers the whole day: 0 → 24:00, or a legacy range (which has no window).
  public var isAllDay: Bool {
    type == .dateRange || ((startMinute ?? 0) <= 0 && (endMinute ?? Availability.fullDay) >= Availability.fullDay)
  }
}

/// An admin's ask for availability over a window of dates.
public struct ApiAvailabilityRequest: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let name: String?
  public let startDate: Date
  public let endDate: Date
  public let orgId: String
  public let createdAt: Date
  public let org: ApiOrgRef?

  public init(id: String, name: String? = nil, startDate: Date, endDate: Date, orgId: String, createdAt: Date, org: ApiOrgRef? = nil) {
    self.id = id
    self.name = name
    self.startDate = startDate
    self.endDate = endDate
    self.orgId = orgId
    self.createdAt = createdAt
    self.org = org
  }
}

/// My answer to one request. A row with `completedAt` = submitted.
public struct ApiAvailabilityResponse: Codable, Hashable, Sendable {
  public let requestId: String
  public let completedAt: Date?
  public let edited: Bool?
  public let note: String?

  public init(requestId: String, completedAt: Date? = nil, edited: Bool? = nil, note: String? = nil) {
    self.requestId = requestId
    self.completedAt = completedAt
    self.edited = edited
    self.note = note
  }
}

public struct ApiAvailability: Codable, Hashable, Sendable {
  public let entries: [ApiUnavailability]
  public let requests: [ApiAvailabilityRequest]
  public let responses: [ApiAvailabilityResponse]

  public init(entries: [ApiUnavailability], requests: [ApiAvailabilityRequest], responses: [ApiAvailabilityResponse]) {
    self.entries = entries
    self.requests = requests
    self.responses = responses
  }

  public static let empty = ApiAvailability(entries: [], requests: [], responses: [])
}

/// One weekly block to add. Dates are "YYYY-MM-DD"; nil = open-ended.
public struct WeeklyBlockInput: Codable, Hashable, Sendable {
  public let dayOfWeek: Int
  public let startMinute: Int
  public let endMinute: Int
  public let startDate: String?
  public let endDate: String?

  public init(dayOfWeek: Int, startMinute: Int, endMinute: Int, startDate: String? = nil, endDate: String? = nil) {
    self.dayOfWeek = dayOfWeek
    self.startMinute = startMinute
    self.endMinute = endMinute
    self.startDate = startDate
    self.endDate = endDate
  }
}

public enum Availability {
  /// A day with no time window on it is "all day": 24h in minutes.
  public static let fullDay = 24 * 60

  /// How much of a day is blocked. Full wins when both kinds land on it.
  public enum Level: String, Sendable { case full, partial }

  static func day(_ date: Date, calendar: Calendar) -> Date { calendar.startOfDay(for: date) }

  /// Does this weekly rule fire on `date` (a midnight in `calendar`)?
  static func recurringApplies(_ e: ApiUnavailability, on date: Date, ymd: String, calendar: Calendar) -> Bool {
    guard e.type == .recurring, let dow = e.dayOfWeek else { return false }
    // Foundation's weekday is 1 = Sunday; the server's is 0 = Sunday.
    guard calendar.component(.weekday, from: date) - 1 == dow else { return false }
    if let start = e.startDate, date < day(start, calendar: calendar) { return false }
    if let end = e.endDate, date > day(end, calendar: calendar) { return false }
    // A date freed from the calendar is a hole in the pattern, not its end.
    return !(e.exceptDates ?? []).contains(ymd)
  }

  /// Does this dated block (one day or a range) cover `date`?
  static func datedApplies(_ e: ApiUnavailability, on date: Date, calendar: Calendar) -> Bool {
    guard e.type != .recurring, let start = e.startDate else { return false }
    let first = day(start, calendar: calendar)
    let last = day(e.endDate ?? start, calendar: calendar)
    return date >= first && date <= last
  }

  /// The blocks that land on one day, weekly and dated alike.
  public static func blocks(on ymd: String, in entries: [ApiUnavailability], calendar: Calendar) -> [ApiUnavailability] {
    guard let date = SetCalendar.date(ymd: ymd, calendar: calendar) else { return [] }
    return entries.filter {
      recurringApplies($0, on: date, ymd: ymd, calendar: calendar) || datedApplies($0, on: date, calendar: calendar)
    }
  }

  /// lib/availability.ts dayBlockLevel.
  public static func level(_ entries: [ApiUnavailability], on ymd: String, calendar: Calendar) -> Level? {
    let hits = blocks(on: ymd, in: entries, calendar: calendar)
    if hits.isEmpty { return nil }
    return hits.contains(where: \.isAllDay) ? .full : .partial
  }

  /// Does a WEEKLY repeat cover this day? Marked on its own: the repeat goes
  /// on next week, which a block made by hand doesn't.
  public static func isRepeating(_ entries: [ApiUnavailability], on ymd: String, calendar: Calendar) -> Bool {
    guard let date = SetCalendar.date(ymd: ymd, calendar: calendar) else { return false }
    return entries.contains { recurringApplies($0, on: date, ymd: ymd, calendar: calendar) }
  }

  /// The days an all-day DATED block covers: the ones a tap CLEARS instead of
  /// blocking. Weekly rules deliberately don't count, so a day that's red from
  /// a repeat alone still takes a dated block on the first tap.
  public static func allDayBlockedDays(_ entries: [ApiUnavailability], calendar: Calendar) -> Set<String> {
    var days = Set<String>()
    for e in entries where e.type != .recurring && e.isAllDay {
      guard let start = e.startDate else { continue }
      var cursor = day(start, calendar: calendar)
      let last = day(e.endDate ?? start, calendar: calendar)
      // A runaway range would be a server bug; never spin on one.
      var guardrail = 0
      while cursor <= last, guardrail < 3660 {
        days.insert(SetCalendar.ymd(cursor, calendar: calendar))
        guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
        cursor = next
        guardrail += 1
      }
    }
    return days
  }

  /// What a tap on a day does: block it all day, unless a dated all-day block
  /// is already there, in which case the tap frees it.
  public static func tapBlocks(_ entries: [ApiUnavailability], on ymd: String, calendar: Calendar) -> Bool {
    !allDayBlockedDays(entries, calendar: calendar).contains(ymd)
  }

  /// The entries as they'd read right after a tap, so the grid can answer
  /// before the server does. The reload afterwards is still the truth.
  public static func applyingTap(_ entries: [ApiUnavailability], on ymd: String, block: Bool, calendar: Calendar) -> [ApiUnavailability] {
    guard let date = SetCalendar.date(ymd: ymd, calendar: calendar) else { return entries }
    if block {
      return entries + [ApiUnavailability(id: "local-\(ymd)", type: .specific, startMinute: 0, endMinute: fullDay, startDate: date)]
    }
    return entries.compactMap { e in
      if e.type == .recurring {
        guard recurringApplies(e, on: date, ymd: ymd, calendar: calendar) else { return e }
        return ApiUnavailability(
          id: e.id, type: e.type, dayOfWeek: e.dayOfWeek, startMinute: e.startMinute, endMinute: e.endMinute,
          startDate: e.startDate, endDate: e.endDate, exceptDates: (e.exceptDates ?? []) + [ymd],
          requestId: e.requestId, fromGoogle: e.fromGoogle, note: e.note
        )
      }
      // A multi-day block loses more than this day here; the reload restores
      // the days that survive.
      return datedApplies(e, on: date, calendar: calendar) ? nil : e
    }
  }

  // MARK: Requests

  /// Each org's active request: its most recent one.
  public static func activeRequests(_ requests: [ApiAvailabilityRequest]) -> [ApiAvailabilityRequest] {
    var seen = Set<String>()
    return requests
      .sorted { $0.createdAt > $1.createdAt }
      .filter { seen.insert($0.orgId).inserted }
  }

  public static func isSubmitted(_ request: ApiAvailabilityRequest, responses: [ApiAvailabilityResponse]) -> Bool {
    responses.contains { $0.requestId == request.id && $0.completedAt != nil }
  }

  /// The active requests I still owe an answer to.
  public static func owed(_ availability: ApiAvailability) -> [ApiAvailabilityRequest] {
    activeRequests(availability.requests).filter { !isSubmitted($0, responses: availability.responses) }
  }

  /// Every blocked day inside a request's window, in order: what the submit
  /// sheet lists so the person sees what they're about to send.
  public static func blockedDays(
    _ entries: [ApiUnavailability], from: Date, to: Date, calendar: Calendar
  ) -> [(ymd: String, date: Date, level: Level)] {
    var out: [(ymd: String, date: Date, level: Level)] = []
    var cursor = day(from, calendar: calendar)
    let last = day(to, calendar: calendar)
    var guardrail = 0
    while cursor <= last, guardrail < 3660 {
      let ymd = SetCalendar.ymd(cursor, calendar: calendar)
      if let level = level(entries, on: ymd, calendar: calendar) { out.append((ymd, cursor, level)) }
      guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
      cursor = next
      guardrail += 1
    }
    return out
  }

  // MARK: Words

  public static let dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

  /// "6 PM", "6:30 PM", "12 AM". 1440 reads as midnight.
  public static func timeLabel(_ minutes: Int) -> String {
    let m = ((minutes % fullDay) + fullDay) % fullDay
    let hour24 = m / 60
    let minute = m % 60
    let hour12 = hour24 % 12 == 0 ? 12 : hour24 % 12
    let suffix = hour24 < 12 ? "AM" : "PM"
    return minute == 0 ? "\(hour12) \(suffix)" : String(format: "%d:%02d %@", hour12, minute, suffix)
  }

  /// "All day" or "6 PM – 9 PM".
  public static func windowLabel(_ e: ApiUnavailability) -> String {
    if e.isAllDay { return "All day" }
    return "\(timeLabel(e.startMinute ?? 0)) – \(timeLabel(e.endMinute ?? fullDay))"
  }

  /// The weekly rules, Sunday first, earliest window first.
  public static func weeklyRules(_ entries: [ApiUnavailability]) -> [ApiUnavailability] {
    entries
      .filter { $0.type == .recurring && $0.dayOfWeek != nil }
      .sorted { ($0.dayOfWeek ?? 0, $0.startMinute ?? 0, $0.id) < ($1.dayOfWeek ?? 0, $1.startMinute ?? 0, $1.id) }
  }

  /// "Every Tuesday".
  public static func weeklyTitle(_ e: ApiUnavailability) -> String {
    guard let dow = e.dayOfWeek, dayNames.indices.contains(dow) else { return "Every week" }
    return "Every \(dayNames[dow])"
  }

  /// Dated blocks that only cover part of a day and haven't passed: the ones
  /// the grid can only show as an amber dot.
  public static func timedBlocks(_ entries: [ApiUnavailability], now: Date, calendar: Calendar) -> [ApiUnavailability] {
    let today = day(now, calendar: calendar)
    return entries
      .filter { e in
        guard e.type != .recurring, !e.isAllDay, let start = e.startDate else { return false }
        return day(e.endDate ?? start, calendar: calendar) >= today
      }
      .sorted { ($0.startDate ?? .distantPast, $0.startMinute ?? 0, $0.id) < ($1.startDate ?? .distantPast, $1.startMinute ?? 0, $1.id) }
  }

  /// Why a weekly block can't be saved yet, or nil when it can.
  public static func weeklyProblem(days: Set<Int>, startMinute: Int, endMinute: Int) -> String? {
    if days.isEmpty { return "Pick at least one day." }
    if startMinute >= endMinute { return "The end time has to be after the start." }
    return nil
  }
}

extension APIClient {
  public func availability() async throws -> ApiAvailability {
    try await send("GET", "/api/availability")
  }

  /// Paint (`blocked`) or free a run of whole days. Dates are "YYYY-MM-DD".
  public func blockDays(start: String, end: String, blocked: Bool) async throws {
    struct Body: Encodable { let start: String; let end: String; let blocked: Bool }
    let _: Ignored = try await send("POST", "/api/availability/block-days", body: Body(start: start, end: end, blocked: blocked))
  }

  public func addWeekly(_ blocks: [WeeklyBlockInput]) async throws {
    struct Body: Encodable { let type = "RECURRING"; let blocks: [WeeklyBlockInput] }
    let _: Ignored = try await send("POST", "/api/availability", body: Body(blocks: blocks))
  }

  /// Block part of one day. `requestId` ties it to the request it answers.
  public func addTimed(date: String, startMinute: Int, endMinute: Int, requestId: String? = nil) async throws {
    struct Window: Encodable { let startMinute: Int; let endMinute: Int }
    struct Body: Encodable { let type = "SPECIFIC"; let date: String; let windows: [Window]; let requestId: String? }
    let _: Ignored = try await send(
      "POST", "/api/availability",
      body: Body(date: date, windows: [Window(startMinute: startMinute, endMinute: endMinute)], requestId: requestId)
    )
  }

  public func deleteAvailability(_ id: String) async throws {
    let _: Ignored = try await send("DELETE", "/api/availability/\(id)")
  }

  /// Submit my availability for a request, or take the submit back. A nil
  /// note leaves the stored one alone, which is how un-submitting keeps it.
  public func toggleAvailabilityComplete(requestId: String, note: String? = nil) async throws {
    struct Body: Encodable { let requestId: String; let note: String? }
    let _: Ignored = try await send("POST", "/api/availability/complete", body: Body(requestId: requestId, note: note))
  }
}
