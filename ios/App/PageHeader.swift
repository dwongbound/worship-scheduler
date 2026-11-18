import SwiftUI

// The top of a tab's main page: its big title with the page's buttons on the
// same line (the + sits beside "Unavailabilities", not floating above it).
// On iOS 26 this uses the bar's own large-title slot, so it still shrinks into
// the bar on scroll like any other title; earlier iOS keeps the buttons in the
// bar's corner.

extension View {
  func pageHeader<Actions: View>(_ title: String, @ViewBuilder actions: @escaping () -> Actions) -> some View {
    modifier(PageHeader(title: title, actions: actions))
  }
}

struct PageHeader<Actions: View>: ViewModifier {
  let title: String
  let actions: () -> Actions

  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content
        .navigationTitle(title)
        .toolbar {
          ToolbarItem(placement: .largeTitle) {
            HStack(alignment: .center, spacing: 10) {
              Text(title)
                .font(.largeTitle.bold())
                .lineLimit(1)
                .fixedSize()
                .accessibilityAddTraits(.isHeader)
              Spacer(minLength: 8)
              actions()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
    } else {
      content
        .navigationTitle(title)
        .toolbar {
          ToolbarItemGroup(placement: .topBarTrailing) { actions() }
        }
    }
  }
}

/// A round icon button for the header row: the same size as the bar's own
/// glass buttons, so it reads as part of the header.
struct HeaderIconButton: View {
  let label: String
  let systemImage: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: systemImage)
        .font(.title3.weight(.semibold))
        .frame(width: 40, height: 40)
        .background(Circle().fill(Color(.tertiarySystemFill)))
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }
}
