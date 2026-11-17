import Foundation

// The Calendar tab: GET /api/sets for a window, grouped by day, plus the
// reading of one set's roster. Mirrors app/calendar, lib/setStatus.ts and
// lib/teamRoles.ts. Reading only: editing a roster stays on the web, where the
// set modal's staged edits and Auto schedule live.

public enum SetCalendar {
  /// "YYYY-MM-DD" for the day `date` falls on in `calendar`'s zone — the
  /// spelling ?from= / ?to= take and the key days are grouped under.
  public static func ymd(_ date: Date, calendar: Calendar) -> String {
    let c = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
  }

  /// The day a "YYYY-MM-DD" names, at its midnight in `calendar`'s zone.
  public static func date(ymd: String, calendar: Calendar) -> Date? {
    let parts = ymd.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
  }

  /// The path for one window of sets. `orgId` narrows to one org.
  public static func path(from: Date, to: Date, orgId: String? = nil, calendar: Calendar) -> String {
    var path = "/api/sets?from=\(ymd(from, calendar: calendar))&to=\(ymd(to, calendar: calendar))"
    if let orgId { path += "&orgId=\(orgId)" }
    return path
  }

  /// First day of the month `date` is in.
  public static func monthStart(_ date: Date, calendar: Calendar) -> Date {
    calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? date
  }

  /// The month's cells for a 7-column grid: nil for the blanks before the 1st,
  /// then every day. Always whole weeks, so the grid's height only changes
  /// between 4, 5 and 6 rows.
  public static func monthCells(_ month: Date, calendar: Calendar) -> [Date?] {
    let start = monthStart(month, calendar: calendar)
    guard let range = calendar.range(of: .day, in: .month, for: start) else { return [] }
    let lead = (calendar.component(.weekday, from: start) - calendar.firstWeekday + 7) % 7
    var cells: [Date?] = Array(repeating: nil, count: lead)
    for offset in 0..<range.count {
      cells.append(calendar.date(byAdding: .day, value: offset, to: start))
    }
    while cells.count % 7 != 0 { cells.append(nil) }
    return cells
  }

  /// Sets keyed by the day they start on, each day soonest first.
  public static func byDay(_ sets: [ApiSet], calendar: Calendar) -> [String: [ApiSet]] {
    var out: [String: [ApiSet]] = [:]
    for set in sets.sorted(by: { ($0.startsAt, $0.id) < ($1.startsAt, $1.id) }) {
      out[ymd(set.startsAt, calendar: calendar), default: []].append(set)
    }
    return out
  }

  /// The seats `userId` holds on a set.
  public static func seats(of userId: String?, on set: ApiSet) -> [ApiAssignment] {
    guard let userId else { return [] }
    return set.assignments.filter { $0.user.id == userId }
  }

  // MARK: Roster

  /// lib/teamRoles.ts DEFAULT_TEAM_ROLES, minus MD: what a set with no team
  /// catalog falls back to.
  public static let defaultCatalog: [TeamRoleDef] = [
    ("WORSHIP_LEADER", 1), ("DRUMS", 1), ("BASS", 1), ("KEYS", 1), ("ACOUSTIC_GUITAR", 1),
    ("ELECTRIC_GUITAR", 2), ("STRINGS", 0), ("VOCALS", 2), ("AV", 1),
  ].enumerated().map { index, role in
    TeamRoleDef(key: role.0, label: RoleLabels.builtIn[role.0] ?? role.0, defaultCount: role.1, adminOnly: false, order: index)
  }

  static let mdKey = "MD"
  static let acousticKey = "ACOUSTIC_GUITAR"

  /// The catalog in display order, without MD (a designation, not a seat).
  static func slotted(_ catalog: [TeamRoleDef]) -> [TeamRoleDef] {
    catalog.filter { $0.key != mdKey }.sorted { ($0.order, $0.key) < ($1.order, $1.key) }
  }

  public struct RosterRow: Hashable, Identifiable, Sendable {
    public let id: String
    public let label: String
    public let people: [ApiAssignment]
    /// Seats this role still wants.
    public let open: Int
    /// The lending team's name, for a borrowed role.
    public let guestTeam: String?
  }

  /// A set's roster the way the web's set modal reads it: the owning team's
  /// roles in catalog order with their open seats, then each guest team's
  /// borrowed roles, then anyone seated in a role the team has since deleted.
  public static func roster(_ set: ApiSet) -> [RosterRow] {
    let catalog = set.team?.roles ?? defaultCatalog
    var rows: [RosterRow] = []
    var placed = Set<String>()
    let own = set.assignments.filter { $0.guestTeamId == nil }

    for role in slotted(catalog) {
      let people = own.filter { $0.role == role.key }
      let capacity = set.slotCapacities?[role.key] ?? role.defaultCount
      if people.isEmpty && capacity <= 0 { continue }
      people.forEach { placed.insert($0.id) }
      rows.append(RosterRow(id: role.key, label: role.label, people: people, open: max(0, capacity - people.count), guestTeam: nil))
    }
    for guest in set.guestTeams ?? [] {
      for spec in guest.roles {
        let people = set.assignments.filter { $0.guestTeamId == guest.id && $0.role == spec.role }
        people.forEach { placed.insert($0.id) }
        rows.append(RosterRow(
          id: "\(guest.id):\(spec.role)",
          label: RoleLabels.label(for: spec.role, in: guest.team?.roles),
          people: people,
          open: spec.openSeats(filled: people.count),
          guestTeam: guest.team?.name
        ))
      }
    }
    // Never drop a person: a seat whose role nothing above names still shows.
    let strays = set.assignments.filter { !placed.contains($0.id) }
    for key in Array(Set(strays.map(\.role))).sorted() {
      rows.append(RosterRow(id: "stray:\(key)", label: RoleLabels.label(for: key, in: catalog),
                            people: strays.filter { $0.role == key }, open: 0, guestTeam: nil))
    }
    return rows
  }

  // MARK: Status

  /// lib/setStatus.ts — the colour a set wears on the calendar.
  public enum Status: String, Sendable {
    case understaffed, confirmed, unconfirmed, cover

    public var label: String {
      switch self {
      case .understaffed: "Needs people"
      case .confirmed: "Confirmed"
      case .unconfirmed: "Waiting on confirmations"
      case .cover: "Cover needed"
      }
    }
  }

  /// Open seats, the web's way: an empty acoustic guitar on the owning team is
  /// never a hole, and an unbounded guest seat is never short.
  public static func openSlots(_ set: ApiSet) -> Int {
    roster(set).reduce(0) { total, row in
      row.guestTeam == nil && row.id == acousticKey ? total : total + row.open
    }
  }

  public static func status(_ set: ApiSet) -> Status {
    if set.assignments.contains(where: { $0.status == .swapRequested }) { return .cover }
    if set.assignments.isEmpty || openSlots(set) > 0 { return .understaffed }
    if set.assignments.contains(where: { $0.status == .pending || $0.status == .pendingApproval }) { return .unconfirmed }
    return .confirmed
  }

  /// The set's musical director: the designated one, shown by id.
  public static func isMD(_ seat: ApiAssignment, on set: ApiSet) -> Bool {
    guard let md = set.mdUserId else { return false }
    return (seat.pendingFromUser?.id ?? seat.user.id) == md
  }
}

extension APIClient {
  public func sets(from: Date, to: Date, orgId: String? = nil, calendar: Calendar) async throws -> [ApiSet] {
    try await send("GET", SetCalendar.path(from: from, to: to, orgId: orgId, calendar: calendar))
  }
}
