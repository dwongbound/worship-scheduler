import Foundation

public enum TapWorship {
  /// The ONE decoder for anything coming off the API.
  ///
  /// `.iso8601` alone is wrong here and fails loudly: `JSON.stringify` of a
  /// JavaScript Date emits milliseconds (`2026-10-11T17:00:00.000Z`), and
  /// Foundation's built-in ISO-8601 strategy rejects fractional seconds
  /// outright. Every date on every route arrives that way, so a decoder
  /// without this parses nothing at all.
  ///
  /// Both spellings are accepted rather than just the one Prisma happens to
  /// send today: a hand-written route that builds its own `toISOString()` or
  /// trims the milliseconds shouldn't be a crash on a device you can't
  /// hot-fix.
  public static func makeDecoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { decoder in
      let text = try decoder.singleValueContainer().decode(String.self)
      guard let date = parseISO8601(text) else {
        throw DecodingError.dataCorrupted(
          .init(
            codingPath: decoder.codingPath,
            debugDescription: "Not an ISO-8601 date: \(text)"
          )
        )
      }
      return date
    }
    return decoder
  }

  /// Dates go back out the way they came in, milliseconds included, so a
  /// round-trip through this client can't quietly reformat a timestamp.
  public static func makeEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .custom { date, encoder in
      var container = encoder.singleValueContainer()
      try container.encode(withFractional.string(from: date))
    }
    return encoder
  }

  // Two formatters, because one ISO8601DateFormatter cannot accept both
  // forms: `.withFractionalSeconds` makes the fraction REQUIRED, not optional.
  private static let withFractional: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()

  private static let withoutFractional: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
  }()

  public static func parseISO8601(_ text: String) -> Date? {
    withFractional.date(from: text) ?? withoutFractional.date(from: text)
  }
}
