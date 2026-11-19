import SwiftUI

/// The app's tabs as a strip across the top (the system bar at the bottom is
/// hidden), leaving the bottom of the screen to each page's action buttons.
struct TopTabBar: View {
  struct Item: Identifiable {
    let tab: AppTab
    let title: String
    let systemImage: String
    let badge: Int
    var id: AppTab { tab }
  }

  let items: [Item]
  @Binding var selection: AppTab
  @Namespace private var highlight

  var body: some View {
    HStack(spacing: 2) {
      ForEach(items) { item in
        let on = item.tab == selection
        Button {
          withAnimation(.smooth(duration: 0.25)) { selection = item.tab }
        } label: {
          VStack(spacing: 2) {
            Image(systemName: item.systemImage)
              .font(.system(size: 18, weight: .medium))
              .frame(height: 22)
              .overlay(alignment: .topTrailing) {
                if item.badge > 0 {
                  Text("\(item.badge)")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 5)
                    .frame(minWidth: 16, minHeight: 16)
                    .background(Capsule().fill(.red))
                    .offset(x: 10, y: -6)
                }
              }
            Text(item.title)
              .font(.caption2.weight(on ? .semibold : .regular))
              .lineLimit(1)
              .minimumScaleFactor(0.75)
          }
          .foregroundStyle(on ? Color.accentColor : Color.primary)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 7)
          .background {
            if on {
              Capsule()
                .fill(Color.primary.opacity(0.1))
                .matchedGeometryEffect(id: "tab", in: highlight)
            }
          }
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.badge > 0 ? "\(item.title), \(item.badge) new" : item.title)
        .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
      }
    }
    .padding(4)
    // The same floating glass capsule as iOS's own tab bar, just at the top.
    .modifier(GlassCapsule())
    .padding(.horizontal, 12)
    .padding(.top, 2)
    .padding(.bottom, 6)
    .sensoryFeedback(.selection, trigger: selection)
  }
}

private struct GlassCapsule: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.glassEffect(.regular, in: Capsule())
    } else {
      content
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.primary.opacity(0.08)))
        .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
    }
  }
}
