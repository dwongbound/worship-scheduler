import SwiftUI
import TapWorshipKit

// The first screen: a smoke test you can see, not the real app.
//
// It exists so the very first build proves the two things that are easy to
// get silently wrong — that the app target actually links TapWorshipKit, and
// that the kit's decoder handles a real payload ON DEVICE rather than only in
// `swift run Checks` on a Mac. It gets replaced by the real first screen
// (sign-in) once there's an auth scheme to sign in against.
struct FirstRunView: View {
  private let sample = Self.decodeSample()

  var body: some View {
    VStack(spacing: 16) {
      Text("TapWorship")
        .font(.largeTitle.weight(.semibold))

      switch sample {
      case .success(let set):
        VStack(spacing: 4) {
          Label("TapWorshipKit linked and decoding", systemImage: "checkmark.seal.fill")
            .foregroundStyle(.green)
          Text(set.label ?? "Untitled set")
            .font(.headline)
          Text(set.startsAt.formatted(date: .abbreviated, time: .shortened))
            .foregroundStyle(.secondary)
          Text("\(set.assignments.count) on the roster")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      case .failure(let error):
        Label(error.localizedDescription, systemImage: "xmark.octagon.fill")
          .foregroundStyle(.red)
          .multilineTextAlignment(.center)
      }

      Text("Not wired to a server yet — sign-in needs the token endpoint.")
        .font(.footnote)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }
    .padding()
  }

  // The same fixture shape the Checks suite uses, so a mismatch between the
  // kit and a real payload shows up here too.
  private static func decodeSample() -> Result<ApiSet, Error> {
    let json = """
    {
      "id": "set_1", "label": "Large Group",
      "startsAt": "2026-10-11T17:00:00.000Z", "durationMinutes": 90,
      "notes": null, "requiresMD": true, "isPrivate": false,
      "mdUserId": "u_2", "slotCapacities": { "VOCALS": 3 },
      "assignments": [
        { "id": "a_1", "role": "KEYS", "status": "CONFIRMED",
          "user": { "id": "u_2", "name": "Priya Patel", "isMD": true } }
      ]
    }
    """
    return Result { try TapWorship.makeDecoder().decode(ApiSet.self, from: Data(json.utf8)) }
  }
}
