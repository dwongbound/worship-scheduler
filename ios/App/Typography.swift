import SwiftUI
import UIKit
import CoreText

// Figtree, the web app's typeface (app/layout.tsx), everywhere in the app.
// The four weights the app uses ship in Fonts/ (SIL Open Font License,
// Fonts/OFL.txt) and are registered at launch. Every size is tied to a text
// style, so Dynamic Type still scales it like the system font.

enum TW {
  static let family = "Figtree"

  static let largeTitle = style(34, .largeTitle, .bold)
  static let title = style(28, .title)
  static let title2 = style(22, .title2)
  static let title3 = style(20, .title3)
  static let headline = style(17, .headline, .semibold)
  static let body = style(17, .body)
  static let callout = style(16, .callout)
  static let subheadline = style(15, .subheadline)
  static let footnote = style(13, .footnote)
  static let caption = style(12, .caption)
  static let caption2 = style(11, .caption2)

  private static func style(_ size: CGFloat, _ textStyle: Font.TextStyle, _ weight: Font.Weight = .regular) -> Font {
    Font.custom(family, size: size, relativeTo: textStyle).weight(weight)
  }

  /// Registers the bundled faces and points the UIKit-drawn parts (bar
  /// titles, tab labels, segmented controls) at them. Call once at launch.
  static func install() {
    for name in ["Figtree-Regular", "Figtree-Medium", "Figtree-SemiBold", "Figtree-Bold"] {
      if let url = Bundle.main.url(forResource: name, withExtension: "ttf") {
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
      }
    }
    func ui(_ name: String, _ size: CGFloat, _ style: UIFont.TextStyle) -> UIFont {
      let base = UIFont(name: name, size: size) ?? .systemFont(ofSize: size)
      return UIFontMetrics(forTextStyle: style).scaledFont(for: base)
    }
    UIView.appearance().tintColor = UIColor(named: "AccentColor")
    let nav = UINavigationBar.appearance()
    nav.titleTextAttributes = [.font: ui("Figtree-SemiBold", 17, .headline)]
    nav.largeTitleTextAttributes = [.font: ui("Figtree-Bold", 34, .largeTitle)]
    UIBarButtonItem.appearance().setTitleTextAttributes([.font: ui("Figtree-Medium", 17, .body)], for: .normal)
    UITabBarItem.appearance().setTitleTextAttributes([.font: ui("Figtree-Medium", 10, .caption2)], for: .normal)
    UISegmentedControl.appearance().setTitleTextAttributes([.font: ui("Figtree-Medium", 14, .subheadline)], for: .normal)
    UISegmentedControl.appearance().setTitleTextAttributes([.font: ui("Figtree-SemiBold", 14, .subheadline)], for: .selected)
  }
}
