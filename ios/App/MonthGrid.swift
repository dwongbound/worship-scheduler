import SwiftUI
import TapWorshipKit

/// A month as a seven-column grid, with ‹ › to move. The Calendar and
/// Availability tabs both draw on it; what goes in a day is the caller's.
///
/// Always six rows, whichever month it is, so nothing under the grid jumps
/// when the month changes.
struct MonthGrid<Cell: View>: View {
  @Binding var month: Date
  let calendar: Calendar
  @ViewBuilder let cell: (Date) -> Cell

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var cells: [Date?] {
    var out = SetCalendar.monthCells(month, calendar: calendar)
    while out.count < 42 { out.append(nil) }
    return out
  }

  private var title: String {
    var style = Date.FormatStyle.dateTime.month(.wide).year()
    style.timeZone = calendar.timeZone
    return month.formatted(style)
  }

  /// "S M T W T F S", starting on the calendar's first weekday.
  private var weekdays: [(short: String, full: String)] {
    let short = calendar.veryShortStandaloneWeekdaySymbols
    let full = calendar.standaloneWeekdaySymbols
    return (0..<7).map { offset in
      let index = (calendar.firstWeekday - 1 + offset) % 7
      return (short[index], full[index])
    }
  }

  var body: some View {
    VStack(spacing: 8) {
      HStack {
        Button { step(-1) } label: {
          Image(systemName: "chevron.left")
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("Previous month")
        Spacer()
        Text(title)
          .font(TW.headline)
          .accessibilityAddTraits(.isHeader)
        Spacer()
        Button { step(1) } label: {
          Image(systemName: "chevron.right")
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("Next month")
      }
      .buttonStyle(.borderless)

      LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 7), spacing: 2) {
        ForEach(Array(weekdays.enumerated()), id: \.offset) { _, day in
          Text(day.short)
            .font(TW.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .accessibilityLabel(day.full)
        }
        ForEach(Array(cells.enumerated()), id: \.offset) { _, date in
          if let date {
            cell(date)
          } else {
            Color.clear.frame(height: 44)
          }
        }
      }
    }
    .padding(.vertical, 4)
    // A seven-across grid can't grow without limit; the list under it
    // carries the same days as full-size text.
    .dynamicTypeSize(...DynamicTypeSize.accessibility1)
  }

  private func step(_ months: Int) {
    guard let next = calendar.date(byAdding: .month, value: months, to: SetCalendar.monthStart(month, calendar: calendar)) else { return }
    if reduceMotion {
      month = next
    } else {
      withAnimation(.smooth(duration: 0.25)) { month = next }
    }
  }
}

/// A day's number in a 44pt cell, with room underneath for marks.
struct DayNumber: View {
  let date: Date
  let calendar: Calendar
  var isToday = false
  var isSelected = false

  var body: some View {
    Text("\(calendar.component(.day, from: date))")
      .font(TW.body.weight(isToday ? .bold : .regular))
      .monospacedDigit()
      .foregroundStyle(isSelected ? Color.white : (isToday ? Color.accentColor : Color.primary))
      .frame(width: 32, height: 32)
      .background {
        if isSelected { Circle().fill(Color.accentColor) }
      }
  }
}
