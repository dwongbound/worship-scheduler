import Foundation

/// The Unavailabilities week view's layout, a port of the web's
/// lib/weekView.ts: each day's blocks positioned in hours, coloured by where
/// they came from, spread into side-by-side lanes where they overlap.
public enum WeekView {
  /// Where a block came from; each draws in its own colour.
  public enum Kind: String, Sendable { case google, specific, recurring }

  public struct Block: Sendable, Equatable, Identifiable {
    public let id: String
    public let kind: Kind
    public var startMinute: Int
    public var endMinute: Int
    public var lane: Int
    public var lanes: Int
  }

  /// The view's hours: 6 AM to 10 PM, like the web.
  public static let viewStart = 6 * 60
  public static let viewEnd = 22 * 60

  /// The Sunday that starts `date`'s week, on `calendar`.
  public static func weekStart(_ date: Date, calendar: Calendar) -> Date {
    let day = calendar.startOfDay(for: date)
    let back = calendar.component(.weekday, from: day) - 1
    return calendar.date(byAdding: .day, value: -back, to: day) ?? day
  }

  public static func days(from start: Date, calendar: Calendar) -> [Date] {
    (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
  }

  static func kind(_ e: ApiUnavailability) -> Kind {
    if e.fromGoogle == true { return .google }
    return e.type == .recurring ? .recurring : .specific
  }

  /// One day's blocks, positioned. Overlapping imported blocks merge into one
  /// (another import over the same afternoon shouldn't draw two half columns);
  /// anything else that overlaps takes the first free lane in its cluster.
  public static func dayBlocks(_ entries: [ApiUnavailability], on ymd: String, calendar: Calendar) -> [Block] {
    var raw = Availability.blocks(on: ymd, in: entries, calendar: calendar)
      .map { e -> Block in
        let allDay = e.isAllDay
        return Block(
          id: e.id, kind: kind(e),
          startMinute: allDay ? 0 : (e.startMinute ?? 0),
          endMinute: allDay ? Availability.fullDay : (e.endMinute ?? Availability.fullDay),
          lane: 0, lanes: 1
        )
      }
      .filter { $0.endMinute > $0.startMinute }
      .sorted { ($0.startMinute, -$0.endMinute, $0.id) < ($1.startMinute, -$1.endMinute, $1.id) }

    // Merge overlapping imports.
    var merged: [Block] = []
    var openGoogle: Int?
    for b in raw {
      guard b.kind == .google else { merged.append(b); continue }
      if let i = openGoogle, b.startMinute <= merged[i].endMinute {
        merged[i].endMinute = max(merged[i].endMinute, b.endMinute)
        continue
      }
      merged.append(b)
      openGoogle = merged.count - 1
    }
    raw = merged

    // Lanes, per cluster of mutually overlapping blocks.
    var out: [Block] = []
    var cluster: [Block] = []
    var clusterEnd = -1
    var laneEnds: [Int] = []
    func close() {
      let lanes = max(1, (cluster.map(\.lane).max() ?? 0) + 1)
      out += cluster.map { var b = $0; b.lanes = lanes; return b }
      cluster = []
      laneEnds = []
    }
    for var b in raw {
      if b.startMinute >= clusterEnd && !cluster.isEmpty { close() }
      let lane = laneEnds.firstIndex { $0 <= b.startMinute } ?? laneEnds.count
      if lane == laneEnds.count { laneEnds.append(b.endMinute) } else { laneEnds[lane] = b.endMinute }
      b.lane = lane
      cluster.append(b)
      clusterEnd = max(clusterEnd, b.endMinute)
    }
    if !cluster.isEmpty { close() }
    return out
  }

  /// The blocks trimmed to the view's hours; ones wholly outside are dropped.
  /// Real times stay on the block; the drawn span is `top`/`bottom`.
  public static func clipped(_ blocks: [Block], from: Int = viewStart, to: Int = viewEnd) -> [(block: Block, top: Int, bottom: Int)] {
    blocks.compactMap { b in
      let top = max(b.startMinute, from)
      let bottom = min(b.endMinute, to)
      return bottom > top ? (b, top, bottom) : nil
    }
  }
}
