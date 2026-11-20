import Foundation

/// Import from Google Calendar, the web's /schedule screen in the app: pick
/// which of your own calendars to read, preview the busy windows, then import
/// them as blocks for an availability request. The server does the reading;
/// the first time, it needs a one-time Google consent (`authorizeURL`).
public enum GoogleImport {
  public struct Calendar: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let primary: Bool
    public init(id: String, name: String, primary: Bool) {
      self.id = id; self.name = name; self.primary = primary
    }
  }

  /// One busy window on one day, as the preview shows it.
  public struct Window: Codable, Hashable, Sendable {
    public let ymd: String
    public let startMinute: Int
    public let endMinute: Int
    public init(ymd: String, startMinute: Int, endMinute: Int) {
      self.ymd = ymd; self.startMinute = startMinute; self.endMinute = endMinute
    }
  }

  /// What a read answers: the data, or "send them to Google first".
  public enum Answer<T: Sendable>: Sendable {
    case ok(T)
    case needsConsent
  }

  /// Where the server sends the consent sheet back to.
  public static let returnScheme = "tapworship"

  /// The status on the return URL: "connected", "denied" or "error".
  public static func returnStatus(_ url: URL) -> String? {
    guard url.scheme == returnScheme, url.host == "gcal-import" else { return nil }
    return URLComponents(url: url, resolvingAgainstBaseURL: false)?
      .queryItems?.first { $0.name == "status" }?.value
  }

  /// A preview's windows grouped by day, in date order: what the screen lists.
  public static func byDay(_ windows: [Window]) -> [(ymd: String, windows: [Window])] {
    Dictionary(grouping: windows, by: \.ymd)
      .map { ($0.key, $0.value.sorted { $0.startMinute < $1.startMinute }) }
      .sorted { $0.0 < $1.0 }
  }

  static func query(_ items: [String: String]) -> String {
    var c = URLComponents()
    c.queryItems = items.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
    return c.percentEncodedQuery ?? ""
  }
}

extension APIClient {
  private struct CalendarsBody: Decodable { let calendars: [GoogleImport.Calendar]?; let needsConsent: Bool? }
  private struct PreviewBody: Decodable { let windows: [GoogleImport.Window]?; let needsConsent: Bool? }
  private struct ImportBody: Decodable { let blocks: Int?; let needsConsent: Bool? }
  private struct AuthorizeBody: Decodable { let url: String }

  public func importCalendars(requestId: String) async throws -> GoogleImport.Answer<[GoogleImport.Calendar]> {
    let body: CalendarsBody = try await send(
      "GET", "/api/google-calendar/import/calendars?" + GoogleImport.query(["requestId": requestId]))
    if body.needsConsent == true { return .needsConsent }
    return .ok(body.calendars ?? [])
  }

  public func importPreview(requestId: String, calendarIds: [String]) async throws -> GoogleImport.Answer<[GoogleImport.Window]> {
    let body: PreviewBody = try await send(
      "GET", "/api/google-calendar/import/preview?" + GoogleImport.query([
        "requestId": requestId, "calendarIds": calendarIds.joined(separator: ","),
      ]))
    if body.needsConsent == true { return .needsConsent }
    return .ok(body.windows ?? [])
  }

  /// Writes the blocks; answers how many.
  public func runImport(requestId: String, calendarIds: [String]) async throws -> GoogleImport.Answer<Int> {
    struct Body: Encodable { let requestId: String; let calendarIds: [String] }
    let body: ImportBody = try await send(
      "POST", "/api/google-calendar/import", body: Body(requestId: requestId, calendarIds: calendarIds))
    if body.needsConsent == true { return .needsConsent }
    return .ok(body.blocks ?? 0)
  }

  /// Google's consent page for this import, to open in a sign-in sheet.
  public func importAuthorizeURL(requestId: String) async throws -> URL {
    let body: AuthorizeBody = try await send(
      "GET", "/api/google-calendar/import/authorize?" + GoogleImport.query(["requestId": requestId]))
    guard let url = URL(string: body.url) else { throw APIError.network("Bad consent URL") }
    return url
  }
}
