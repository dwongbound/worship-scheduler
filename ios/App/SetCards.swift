import SwiftUI
import TapWorshipKit

// The web's set card pieces: a date tile, teal role chips, a team pill.

/// "NOV / 22" in a soft teal tile, leading a set's card.
struct DateTile: View {
  let date: Date

  private func part(_ style: Date.FormatStyle) -> String {
    var s = style
    s.timeZone = AppConfig.appTimeZone
    return date.formatted(s)
  }

  var body: some View {
    VStack(spacing: 0) {
      Text(part(.dateTime.month(.abbreviated)).uppercased())
        .font(TW.caption2.weight(.bold))
        .foregroundStyle(Color.accentColor)
      Text(part(.dateTime.day()))
        .font(TW.title2.weight(.bold))
        .monospacedDigit()
      Text(part(.dateTime.weekday(.abbreviated)))
        .font(TW.caption2)
        .foregroundStyle(.secondary)
    }
    .frame(width: 52, height: 60)
    .background(Color.twAccentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    .accessibilityHidden(true)
  }
}

/// A role I play, as the web's teal pill (indigo-50 / indigo-700 there).
struct RoleChip: View {
  let text: String

  var body: some View {
    Text(text)
      .font(TW.caption.weight(.semibold))
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .foregroundStyle(Color.accentColor)
      .background(Color.twAccentSoft, in: Capsule())
  }
}

/// The set's team, as a small outlined pill.
struct TeamPill: View {
  let text: String

  var body: some View {
    Text(text)
      .font(TW.caption.weight(.medium))
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .foregroundStyle(.secondary)
      .overlay(Capsule().strokeBorder(Color.twBorder))
  }
}
