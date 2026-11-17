import Foundation

// Which addresses a DEBUG build may be pointed at. Pure, so the rule that
// keeps a dev build from sending a password over plain http to the internet
// is checked without a simulator.

public enum DevServer {
  /// The URL a debug build should use, or nil to stay on production.
  ///
  /// https is fine anywhere. Plain http is accepted only where App Transport
  /// Security's local-networking allowance reaches: this machine, a `.local`
  /// name, or a private LAN address.
  public static func url(_ raw: String?) -> URL? {
    guard let text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty,
          let url = URL(string: text), let host = url.host, !host.isEmpty else { return nil }
    switch url.scheme?.lowercased() {
    case "https": return url
    case "http": return isLocal(host) ? url : nil
    default: return nil
    }
  }

  static func isLocal(_ host: String) -> Bool {
    let host = host.lowercased()
    if host == "localhost" || host == "127.0.0.1" || host == "::1" || host.hasSuffix(".local") { return true }
    // A bare name with no dots is a machine on this network.
    if !host.contains(".") && !host.contains(":") { return true }
    let parts = host.split(separator: ".").compactMap { Int($0) }
    guard parts.count == 4, host.split(separator: ".").count == 4 else { return false }
    return parts[0] == 10
      || (parts[0] == 192 && parts[1] == 168)
      || (parts[0] == 172 && (16...31).contains(parts[1]))
  }

  /// A Google client id from the env file, or nil when it's blank or the
  /// build setting was never filled in.
  public static func clientID(_ raw: String?) -> String? {
    guard let text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty, !text.hasPrefix("$(") else { return nil }
    return text
  }
}
