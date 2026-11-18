import SwiftUI

// The top of a tab's main page: its title on the left and the page's buttons
// on the right, all in the bar's own row. No large-title row underneath, so
// there's no empty band between the status bar and the title, and the title
// never shifts as the page scrolls.

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
      // Still set, for the back button and VoiceOver; the bar shows the
      // leading title below instead of a centered one.
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1) }
        ToolbarItemGroup(placement: .topBarTrailing) { actions() }
      }
      .modifier(LeadingTitle(title: title))
  }
}

/// The title as the bar's leading item, without the glass capsule iOS 26
/// draws behind bar items.
private struct LeadingTitle: ViewModifier {
  let title: String

  private var label: some View {
    Text(title)
      .font(.title.bold())
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

/// An icon button for the header: in the bar, iOS draws its round glass.
struct HeaderIconButton: View {
  let label: String
  let systemImage: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Label(label, systemImage: systemImage)
    }
  }
}
