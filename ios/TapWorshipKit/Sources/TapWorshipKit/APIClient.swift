import Foundation
#if canImport(FoundationNetworking)
// Linux keeps URLSession/URLRequest in a separate module; on Apple platforms
// they're part of Foundation and this import doesn't exist.
import FoundationNetworking
#endif

// The one way the app talks to the server. Every request goes through
// `makeRequest`, which is pure — so the headers, the bearer token and the
// body shape are checked in `swift run Checks` without a network.

public enum APIError: Error, Equatable, Sendable {
  /// 401: the token is missing, expired, forged, or its account is gone. The
  /// app's answer is always the same — back to sign-in.
  case unauthorized
  /// Any other non-2xx, with the server's own `{ error }` text when it sent one.
  case server(status: Int, message: String?)
  /// The request never got an answer (offline, timed out, DNS).
  case network(String)
  /// An answer arrived that doesn't match the shapes in Models.swift — a bug,
  /// on one side or the other.
  case decoding(String)

  /// Words for a person, not a developer.
  public var message: String {
    switch self {
    case .unauthorized: "You've been signed out. Sign in again to continue."
    case .server(_, let message?) where !message.isEmpty: message
    case .server: "Something went wrong on our end. Try again in a moment."
    case .network: "Can't reach TapWorship. Check your connection and try again."
    case .decoding: "TapWorship sent something this version of the app doesn't understand. Updating the app may fix it."
    }
  }
}

/// What actually moves bytes. URLSession in the app; a closure in Checks.
public typealias HTTPTransport = @Sendable (URLRequest) async throws -> (Data, URLResponse)

public struct APIClient: Sendable {
  public let baseURL: URL
  private let token: @Sendable () -> String?
  private let transport: HTTPTransport

  public init(
    baseURL: URL,
    token: @escaping @Sendable () -> String?,
    transport: @escaping HTTPTransport = { try await URLSession.shared.data(for: $0) }
  ) {
    self.baseURL = baseURL
    self.token = token
    self.transport = transport
  }

  // MARK: Routes

  public func signIn(username: String, password: String) async throws -> MobileSession {
    struct Body: Encodable { let username: String; let password: String }
    return try await send("POST", "/api/mobile/session", body: Body(username: username, password: password), authorized: false)
  }

  /// My upcoming seats, soonest first.
  public func myAssignments() async throws -> [ApiMyAssignment] {
    try await send("GET", "/api/assignments")
  }

  public func act(on assignmentId: String, _ action: AssignmentAction, reason: String? = nil) async throws {
    struct Body: Encodable { let action: AssignmentAction; let reason: String? }
    let _: Ignored = try await send(
      "PATCH",
      "/api/assignments/\(assignmentId)",
      body: Body(action: action, reason: reason)
    )
  }

  // MARK: Plumbing

  /// Pure: the request a call would send. `public` so Checks can see it.
  public func makeRequest(
    _ method: String,
    _ path: String,
    body: (any Encodable)? = nil,
    authorized: Bool = true
  ) throws -> URLRequest {
    guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
      throw APIError.network("Bad path: \(path)")
    }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try TapWorship.makeEncoder().encode(body)
    }
    if authorized, let token = token() {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    return request
  }

  private struct Ignored: Decodable {}
  private struct ServerError: Decodable { let error: String? }

  private func send<T: Decodable>(
    _ method: String,
    _ path: String,
    body: (any Encodable)? = nil,
    authorized: Bool = true
  ) async throws -> T {
    let request = try makeRequest(method, path, body: body, authorized: authorized)
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await transport(request)
    } catch {
      throw APIError.network(error.localizedDescription)
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    try Self.check(status: status, data: data, authorized: authorized)
    if T.self == Ignored.self { return Ignored() as! T }
    do {
      return try TapWorship.makeDecoder().decode(T.self, from: data)
    } catch {
      throw APIError.decoding(String(describing: error))
    }
  }

  /// Pure: what a status code means. On sign-in itself a 401 is a wrong
  /// password, not an expired session, so it keeps the server's words.
  public static func check(status: Int, data: Data, authorized: Bool = true) throws {
    if (200..<300).contains(status) { return }
    let message = (try? JSONDecoder().decode(ServerError.self, from: data))?.error
    if status == 401 && authorized { throw APIError.unauthorized }
    throw APIError.server(status: status, message: message)
  }
}
