import SwiftUI

// A tab's main page: its title at the top left of the bar, and its action
// buttons (+ and friends) floating at the bottom right, just above the tab
// bar, where a thumb reaches them.

extension View {
  func pageHeader<Actions: View>(_ title: String, @ViewBuilder actions: @escaping () -> Actions) -> some View {
    modifier(PageHeader(title: title, actions: actions))
  }
}

struct PageHeader<Actions: View>: ViewModifier {
  let title: String
  let actions: () -> Actions
  @Environment(\.tabBarHeight) private var barHeight

  func body(content: Content) -> some View {
    content
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1) }
      }
      .modifier(LeadingTitle(title: title))
      .safeAreaInset(edge: .bottom, alignment: .trailing, spacing: 0) {
        HStack(spacing: 10) { actions() }
          .modifier(FloatingButtonStyle())
          .padding(.trailing, 16)
          .padding(.bottom, 12 + barHeight)
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
        .font(TW.title2.weight(.semibold))
        .frame(width: 32, height: 32)
    }
    .modifier(ProminentRoundButton())
    .accessibilityLabel(label)
  }
}

/// The page's main action look: a round tinted button (glass on iOS 26).
struct ProminentRoundButton: ViewModifier {
  func body(content: Content) -> some View {
    content.modifier(Prominent()).buttonBorderShape(.circle)
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

/// The title as the bar's leading item, without the glass capsule iOS 26
/// draws behind bar items.
private struct LeadingTitle: ViewModifier {
  let title: String

  private var label: some View {
    Text(title)
      .font(TW.title.bold())
      .lineLimit(1)
      .fixedSize()
      .accessibilityAddTraits(.isHeader)
  }

  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.toolbar {
        ToolbarItem(placement: .topBarLeading) { label }
          .sharedBackgroundVisibility(.hidden)
      }
    } else {
      content.toolbar {
        ToolbarItem(placement: .topBarLeading) { label }
      }
    }
  }
}
