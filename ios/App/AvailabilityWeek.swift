import SwiftUI
import TapWorshipKit

// The web's availability WEEK view (components/AvailabilityWeekView): hours
// down, days across, a box per block coloured by where it came from — sky for
// Google imports, rose for blocks made by hand, amber for weekly repeats.
// 6 AM–10 PM at a fixed height, no scrolling inside. Tapping a day opens its
// drawer, the same as on the month.

enum AvailabilityMode: String, CaseIterable, Identifiable {
  case week = "Week", month = "Month"
  var id: String { rawValue }
}

extension WeekView.Kind {
  var color: Color {
    switch self {
    case .google: Color(red: 0.05, green: 0.65, blue: 0.91)     // sky-500
    case .specific: Color(red: 0.96, green: 0.25, blue: 0.37)   // rose-500
    case .recurring: Color(red: 0.96, green: 0.62, blue: 0.04)  // amber-500
    }
  }
  var title: String {
    switch self {
    case .google: "Google"
    case .specific: "By hand"
    case .recurring: "Weekly"
    }
  }
}

struct AvailabilityWeekGrid: View {
  let entries: [ApiUnavailability]
  @Binding var weekStart: Date
  let calendar: Calendar
  let onDay: (Date) -> Void

  private let hourHeight: CGFloat = 22
  private let gutter: CGFloat = 34
  private var hours: Int { (WeekView.viewEnd - WeekView.viewStart) / 60 }
  private var today: String { SetCalendar.ymd(Date(), calendar: calendar) }
  private var days: [Date] { WeekView.days(from: weekStart, calendar: calendar) }

  private var title: String {
    guard let last = days.last else { return "" }
    var start = Date.FormatStyle.dateTime.month(.abbreviated).day()
    start.timeZone = calendar.timeZone
    var end = Date.FormatStyle.dateTime.day()
    if calendar.component(.month, from: weekStart) != calendar.component(.month, from: last) {
      end = .dateTime.month(.abbreviated).day()
    }
    end.timeZone = calendar.timeZone
    return "\(weekStart.formatted(start)) – \(last.formatted(end))"
  }

  var body: some View {
    VStack(spacing: 8) {
      HStack {
        Button { shift(-1) } label: { Image(systemName: "chevron.left") }
          .accessibilityLabel("Previous week")
        Spacer()
        Text(title).font(TW.headline)
        Spacer()
        Button { shift(1) } label: { Image(systemName: "chevron.right") }
          .accessibilityLabel("Next week")
      }
      .buttonStyle(.borderless)
      .padding(.horizontal, 6)

      // Day headers.
      HStack(spacing: 0) {
        Color.clear.frame(width: gutter)
        ForEach(days, id: \.self) { day in
          let ymd = SetCalendar.ymd(day, calendar: calendar)
          Button { onDay(day) } label: {
            VStack(spacing: 2) {
              Text(String(Availability.dayNames[calendar.component(.weekday, from: day) - 1].prefix(2)))
                .font(TW.caption2)
                .foregroundStyle(.secondary)
              Text("\(calendar.component(.day, from: day))")
                .font(TW.subheadline.weight(ymd == today ? .bold : .regular))
                .foregroundStyle(ymd == today ? Color.white : Color.primary)
                .frame(width: 28, height: 28)
                .background { if ymd == today { Circle().fill(Color.accentColor) } }
            }
            .frame(maxWidth: .infinity)
            .opacity(ymd < today ? 0.4 : 1)
          }
          .buttonStyle(.plain)
          .disabled(ymd < today)
        }
      }

      // Hours and blocks.
      HStack(alignment: .top, spacing: 0) {
        VStack(alignment: .trailing, spacing: 0) {
          ForEach(0..<hours, id: \.self) { h in
            Text(h % 3 == 0 ? Availability.timeLabel(WeekView.viewStart + h * 60).replacingOccurrences(of: ":00", with: "") : "")
              .font(.system(size: 9))
              .foregroundStyle(.secondary)
              .frame(height: hourHeight, alignment: .top)
              .offset(y: -5)
          }
        }
        .frame(width: gutter - 4, alignment: .trailing)
        .padding(.trailing, 4)

        ForEach(days, id: \.self) { day in
          dayColumn(day)
        }
      }
      .frame(height: CGFloat(hours) * hourHeight)

      WeekLegend(kinds: legendKinds)
    }
    .padding(.vertical, 4)
  }

  private var legendKinds: [WeekView.Kind] {
    let hasGoogle = entries.contains { $0.fromGoogle == true }
    return hasGoogle ? [.google, .specific, .recurring] : [.specific, .recurring]
  }

  private func dayColumn(_ day: Date) -> some View {
    let ymd = SetCalendar.ymd(day, calendar: calendar)
    let blocks = WeekView.clipped(WeekView.dayBlocks(entries, on: ymd, calendar: calendar))
    return GeometryReader { proxy in
      let w = proxy.size.width
      ZStack(alignment: .topLeading) {
        // Hour lines.
        ForEach(0..<hours, id: \.self) { h in
          Rectangle().fill(Color.twBorder.opacity(h % 3 == 0 ? 0.9 : 0.4))
            .frame(height: 0.5)
            .offset(y: CGFloat(h) * hourHeight)
        }
        Rectangle().fill(Color.twBorder.opacity(0.6)).frame(width: 0.5)
        ForEach(blocks, id: \.block.id) { item in
          let laneW = (w - 3) / CGFloat(item.block.lanes)
          RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(item.block.kind.color.opacity(0.28))
            .overlay(
              RoundedRectangle(cornerRadius: 4, style: .continuous)
                .strokeBorder(item.block.kind.color.opacity(0.8), lineWidth: 1)
            )
            .frame(
              width: max(laneW - 2, 2),
              height: max(CGFloat(item.bottom - item.top) / 60 * hourHeight - 1, 3)
            )
            .offset(
              x: 2 + CGFloat(item.block.lane) * laneW,
              y: CGFloat(item.top - WeekView.viewStart) / 60 * hourHeight
            )
        }
      }
      .contentShape(Rectangle())
      .onTapGesture { if ymd >= today { onDay(day) } }
    }
    .opacity(ymd < today ? 0.45 : 1)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(accessibilityText(day, blocks.map(\.block)))
    .accessibilityAddTraits(.isButton)
  }

  private func accessibilityText(_ day: Date, _ blocks: [WeekView.Block]) -> String {
    var style = Date.FormatStyle.dateTime.weekday(.wide).month(.wide).day()
    style.timeZone = calendar.timeZone
    if blocks.isEmpty { return "\(day.formatted(style)), free" }
    let times = blocks.map { $0.startMinute == 0 && $0.endMinute >= Availability.fullDay
      ? "all day" : "\(Availability.timeLabel($0.startMinute)) to \(Availability.timeLabel($0.endMinute))" }
    return "\(day.formatted(style)), unavailable \(times.joined(separator: ", "))"
  }

  private func shift(_ weeks: Int) {
    guard let next = calendar.date(byAdding: .day, value: 7 * weeks, to: weekStart) else { return }
    withAnimation(.smooth(duration: 0.25)) { weekStart = next }
  }
}

struct WeekLegend: View {
  let kinds: [WeekView.Kind]
  var body: some View {
    HStack(spacing: 12) {
      ForEach(kinds, id: \.self) { kind in
        HStack(spacing: 4) {
          RoundedRectangle(cornerRadius: 2).fill(kind.color.opacity(0.35))
            .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(kind.color, lineWidth: 1))
            .frame(width: 12, height: 10)
          Text(kind.title)
        }
      }
      Spacer(minLength: 0)
    }
    .font(TW.caption)
    .foregroundStyle(.secondary)
    .accessibilityElement(children: .combine)
  }
}
