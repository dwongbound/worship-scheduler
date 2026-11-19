import SwiftUI

// The web's LoadingScreen, in the app: the mark, "TapWorship" breathing, and
// an equalizer underneath. Shown once while the app opens, then fades away.

struct SplashView: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var on = false

  var body: some View {
    ZStack {
      Color.twPage.ignoresSafeArea()
      VStack(spacing: 18) {
        Image("SignInMark")
          .resizable()
          .scaledToFit()
          .frame(width: 88, height: 88)
          .accessibilityHidden(true)
        Text("TapWorship")
          .font(TW.title.weight(.bold))
          .opacity(on || reduceMotion ? 1 : 0.55)
        Equalizer(animating: !reduceMotion)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("TapWorship is loading")
    .onAppear {
      guard !reduceMotion else { return }
      withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { on = true }
    }
  }
}

/// Five teal bars bouncing out of step, like the web splash's equalizer.
struct Equalizer: View {
  let animating: Bool

  var body: some View {
    TimelineView(.animation(paused: !animating)) { context in
      let t = context.date.timeIntervalSinceReferenceDate
      HStack(alignment: .bottom, spacing: 5) {
        ForEach(0..<5, id: \.self) { i in
          let phase = sin(t * 5 + Double(i) * 1.1)
          Capsule()
            .fill(Color.accentColor)
            .frame(width: 6, height: animating ? 10 + 18 * (phase + 1) / 2 : 18)
        }
      }
      .frame(height: 28, alignment: .bottom)
    }
  }
}

/// An empty or error state in the brand's look: the icon in a soft teal disc,
/// a title, a line under it, and an optional action.
struct BrandedEmpty<Actions: View>: View {
  let title: String
  let systemImage: String
  var message: String? = nil
  @ViewBuilder var actions: () -> Actions

  var body: some View {
    VStack(spacing: 14) {
      Image(systemName: systemImage)
        .font(.system(size: 34, weight: .semibold))
        .foregroundStyle(Color.accentColor)
        .frame(width: 84, height: 84)
        .background(Circle().fill(Color.twAccentSoft))
        .accessibilityHidden(true)
      Text(title)
        .font(TW.title3.weight(.semibold))
        .multilineTextAlignment(.center)
      if let message {
        Text(message)
          .font(TW.subheadline)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
      actions()
        .padding(.top, 4)
    }
    .padding(32)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .accessibilityElement(children: .contain)
  }
}

extension BrandedEmpty where Actions == EmptyView {
  init(title: String, systemImage: String, message: String? = nil) {
    self.init(title: title, systemImage: systemImage, message: message) { EmptyView() }
  }
}
