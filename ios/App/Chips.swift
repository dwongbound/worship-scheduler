import SwiftUI
import TapWorshipKit

// Compact pickers: several on/off choices in the space of one row, instead of
// a full list row (and a checkmark) per choice.

/// Lays chips out left to right, wrapping onto new lines like text.
struct FlowLayout: Layout {
  var spacing: CGFloat = 8

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
    let height = rows.last.map { $0.y + $0.height } ?? 0
    let width = rows.map(\.width).max() ?? 0
    return CGSize(width: proposal.width ?? width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let rows = arrange(width: bounds.width, subviews: subviews)
    for row in rows {
      var x = bounds.minX
      for index in row.indices {
        let size = subviews[index].sizeThatFits(.unspecified)
        subviews[index].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: ProposedViewSize(size))
        x += size.width + spacing
      }
    }
  }

  private struct Row { var indices: [Int] = []; var y: CGFloat = 0; var width: CGFloat = 0; var height: CGFloat = 0 }

  private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
    var rows: [Row] = []
    var row = Row()
    var y: CGFloat = 0
    for index in subviews.indices {
      let size = subviews[index].sizeThatFits(.unspecified)
      let needed = row.indices.isEmpty ? size.width : row.width + spacing + size.width
      if needed > width, !row.indices.isEmpty {
        rows.append(row)
        y += row.height + spacing
        row = Row(y: y)
      }
      row.width = row.indices.isEmpty ? size.width : row.width + spacing + size.width
      row.height = max(row.height, size.height)
      row.indices.append(index)
    }
    if !row.indices.isEmpty { rows.append(row) }
    return rows
  }
}

/// One on/off choice as a capsule: tinted when on, outlined when off.
struct ToggleChip: View {
  let title: String
  let isOn: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 4) {
        if isOn {
          Image(systemName: "checkmark")
            .font(.caption.weight(.bold))
            .transition(.scale.combined(with: .opacity))
        }
        Text(title)
      }
      .font(.subheadline.weight(isOn ? .semibold : .regular))
      .padding(.horizontal, 12)
      .frame(minHeight: 34)
      .foregroundStyle(isOn ? Color.white : Color.primary)
      .background(Capsule().fill(isOn ? Color.accentColor : Color(.tertiarySystemFill)))
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .animation(.snappy(duration: 0.2), value: isOn)
    .sensoryFeedback(.selection, trigger: isOn)
    .accessibilityAddTraits(isOn ? [.isSelected, .isButton] : .isButton)
  }
}

/// Sunday to Saturday as seven round toggles in one row (the web's day picker
/// on the weekly set-time form). The full day name is the accessible label.
struct WeekdayPicker: View {
  @Binding var selection: Set<Int>

  var body: some View {
    HStack(spacing: 6) {
      ForEach(0..<7, id: \.self) { index in
        let on = selection.contains(index)
        Button {
          if on { selection.remove(index) } else { selection.insert(index) }
        } label: {
          Text(String(Availability.dayNames[index].prefix(1)))
            .font(.subheadline.weight(.semibold))
            .frame(maxWidth: .infinity)
            .frame(height: 40)
            .foregroundStyle(on ? Color.white : Color.primary)
            .background(Circle().fill(on ? Color.accentColor : Color(.tertiarySystemFill)))
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .animation(.snappy(duration: 0.2), value: on)
        .accessibilityLabel(Availability.dayNames[index])
        .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
      }
    }
    .sensoryFeedback(.selection, trigger: selection)
  }
}
