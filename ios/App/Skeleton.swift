import SwiftUI

// Loading skeletons: the screen's real layout drawn as grey placeholders with
// a soft light sweeping across, so a tab looks like itself while it loads and
// the real content fades in over the same shapes.

extension View {
  /// Placeholder look for loading: redacted, shimmering, not tappable, and
  /// read to VoiceOver as one "Loading…" element.
  func skeleton(_ label: String = "Loading") -> some View {
    self
      .redacted(reason: .placeholder)
      .modifier(Shimmer())
      .disabled(true)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(label)
      .transition(.opacity)
  }

  /// How a loaded screen replaces its skeleton: a quick cross-fade.
  func loadedContent() -> some View {
    transition(.opacity.animation(.smooth(duration: 0.35)))
  }
}

/// A band of light sweeping left to right over the placeholders every 1.4s.
/// Off when Reduce Motion is on: the placeholders just sit still.
///
/// Driven by a keyframe animator, which owns its own clock: the old version
/// started a repeat-forever animation in onAppear, and that transaction could
/// catch the page's own layout changes (a tab sliding in) and keep animating
/// them too.
struct Shimmer: ViewModifier {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func body(content: Content) -> some View {
    if reduceMotion {
      content
    } else {
      content.keyframeAnimator(initialValue: CGFloat(-2), repeating: true) { view, phase in
        view.mask {
          GeometryReader { proxy in
            let width = proxy.size.width
            // The 3×-wide gradient starts two widths to the left and slides
            // to 0, so its bright middle crosses the whole view.
            LinearGradient(
              stops: [
                .init(color: .black.opacity(0.45), location: 0),
                .init(color: .black, location: 0.5),
                .init(color: .black.opacity(0.45), location: 1),
              ],
              startPoint: .leading,
              endPoint: .trailing
            )
            .frame(width: max(width, 1) * 3)
            .offset(x: width * phase)
          }
        }
      } keyframes: { _ in
        LinearKeyframe(CGFloat(0), duration: 1.4)
      }
    }
  }
}
