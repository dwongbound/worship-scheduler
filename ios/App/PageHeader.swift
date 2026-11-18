import SwiftUI

// A tab's main page. The tab strip across the top already names the page, so
// the page has no title bar of its own (its title is still set, for VoiceOver
// and for the Back button of anything pushed from it). Its action buttons —
// + and friends — float at the bottom right, where a thumb reaches them.

extension View {
  func pageHeader<Actions: View>(_ title: String, @ViewBuilder actions: @escaping () -> Actions) -> some View {
    modifier(PageHeader(title: title, actions: actions))
  }
}

struct PageHeader<Actions: View>: ViewModifier {
  let title: String
  let actions: () -> Actions

  func body(content: Content) -> some View {
    content
      .navigationTitle(title)
      .toolbar(.hidden, for: .navigationBar)
      .safeAreaInset(edge: .bottom, alignment: .trailing, spacing: 0) {
        HStack(spacing: 10) { actions() }
          .modifier(FloatingButtonStyle())
          .padding(.trailing, 16)
          .padding(.bottom, 12)
      }
  }
}

/// Glass on iOS 26, a plain bordered capsule before it.
private struct FloatingButtonStyle: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.buttonStyle(.glass).controlSize(.large)
    } else {
      content.buttonStyle(.bordered).controlSize(.large).buttonBorderShape(.capsule)
    }
  }
}

/// The page's main action as a round button at the bottom: tinted glass,
/// a thumb's width across.
struct HeaderIconButton: View {
  let label: String
  let systemImage: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: systemImage)
        .font(.title2.weight(.semibold))
        .frame(width: 32, height: 32)
    }
    .modifier(Prominent())
    .buttonBorderShape(.circle)
    .accessibilityLabel(label)
  }

  private struct Prominent: ViewModifier {
    func body(content: Content) -> some View {
      if #available(iOS 26.0, *) {
        content.buttonStyle(.glassProminent)
      } else {
        content.buttonStyle(.borderedProminent)
      }
    }
  }
}
