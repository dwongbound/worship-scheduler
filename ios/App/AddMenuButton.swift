import SwiftUI

/// The page's + that opens into its choices: tap it and it turns into a ×,
/// with the options rising above it as labelled pills (a "speed dial"). Tap
/// an option, the ×, or anywhere else to fold it away.
struct AddMenuButton: View {
  struct Option: Identifiable {
    let title: String
    let systemImage: String
    let action: () -> Void
    var id: String { title }
  }

  @Binding var open: Bool
  let options: [Option]
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    VStack(alignment: .trailing, spacing: 10) {
      if open {
        ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
          Button {
            close()
            option.action()
          } label: {
            Label(option.title, systemImage: option.systemImage)
              .font(TW.subheadline.weight(.semibold))
              .padding(.horizontal, 16)
              .frame(height: 44)
              .background(Capsule().fill(Color.twCard))
              .overlay(Capsule().strokeBorder(Color.twBorder))
              .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
          }
          .buttonStyle(.plain)
          .foregroundStyle(Color.accentColor)
          .transition(.asymmetric(
            insertion: .scale(scale: 0.6, anchor: .bottomTrailing)
              .combined(with: .opacity)
              .animation(.spring(duration: 0.3, bounce: 0.25).delay(Double(options.count - 1 - index) * 0.04)),
            removal: .opacity.animation(.easeOut(duration: 0.12))
          ))
        }
      }

      Button {
        withAnimation(.spring(duration: 0.3, bounce: 0.2)) { open.toggle() }
      } label: {
        Image(systemName: "plus")
          .font(.title2.weight(.semibold))
          .rotationEffect(.degrees(open && !reduceMotion ? 45 : 0))
          .foregroundStyle(.white)
          .frame(width: 56, height: 56)
          .background(Circle().fill(Color.accentColor))
          .shadow(color: .black.opacity(0.18), radius: 8, y: 3)
          .contentShape(Circle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(open ? "Close" : "Add unavailability")
    }
    .sensoryFeedback(.selection, trigger: open)
    // A tap anywhere else folds it away.
    .background {
      if open {
        Color.black.opacity(0.001)
          .frame(width: 4000, height: 4000)
          .contentShape(Rectangle())
          .onTapGesture { close() }
      }
    }
  }

  private func close() {
    withAnimation(.easeOut(duration: 0.15)) { open = false }
  }
}
