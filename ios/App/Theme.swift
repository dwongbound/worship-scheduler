import SwiftUI
import UIKit

// The web app's colors, so the app looks like the same product. The web is
// Tailwind: its `indigo-*` palette is remapped to the brand teal (favicon,
// #3E8A9E at 600), pages are gray-50 / gray-900, cards white / gray-800 with a
// gray-200 / gray-700 border (tailwind.config.ts, components/common/Card.tsx).
// The accent itself is the AccentColor asset (teal 600 light, teal 400 dark).

extension Color {
  /// Page background: gray-50 / gray-900.
  static let twPage = Color(light: 0xF9FAFB, dark: 0x111827)
  /// Card / list row: white / gray-800.
  static let twCard = Color(light: 0xFFFFFF, dark: 0x1F2937)
  /// Card border and dividers: gray-200 / gray-700.
  static let twBorder = Color(light: 0xE5E7EB, dark: 0x374151)
  /// Raised control inside a card (chips, fields): gray-100 / gray-700.
  static let twFill = Color(light: 0xF3F4F6, dark: 0x374151)
  /// Teal tint behind a selected item: indigo-50 / indigo-900 at the web.
  static let twAccentSoft = Color(light: 0xF1F8F9, dark: 0x2B4C56)

  init(light: UInt32, dark: UInt32) {
    self.init(UIColor { traits in
      UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
    })
  }
}

extension UIColor {
  convenience init(hex: UInt32) {
    self.init(
      red: CGFloat((hex >> 16) & 0xFF) / 255,
      green: CGFloat((hex >> 8) & 0xFF) / 255,
      blue: CGFloat(hex & 0xFF) / 255,
      alpha: 1
    )
  }
}

extension View {
  /// A List or Form on the web's page color. (Each list's rows get the card
  /// color from a `.listRowBackground` around its contents: set on the List
  /// itself it never reaches the rows.)
  func twList() -> some View {
    self
      .scrollContentBackground(.hidden)
      .background(Color.twPage)
      .modifier(ReportsScroll())
      .modifier(ClearsTabBar())
  }
}

/// Tells the tab bar which way this list is scrolling (iOS 18+).
private struct ReportsScroll: ViewModifier {
  @Environment(AppModel.self) private var model
  func body(content: Content) -> some View {
    if #available(iOS 18.0, *) {
      content.onScrollGeometryChange(for: CGFloat.self) { geo in
        geo.contentOffset.y + geo.contentInsets.top
      } action: { old, new in
        model.scrolled(from: old, to: new)
      }
    } else {
      content
    }
  }
}

/// Room at the end of a list for the floating tab bar, so its last row can
/// scroll clear of it (the list still runs underneath the glass).
private struct ClearsTabBar: ViewModifier {
  @Environment(\.tabBarHeight) private var barHeight
  func body(content: Content) -> some View {
    content.contentMargins(.bottom, barHeight, for: .scrollContent)
  }
}
