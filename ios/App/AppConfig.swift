import Foundation

/// Where the app's API lives.
///
/// Production unless the Xcode scheme sets `TAPWORSHIP_API_URL` (Product →
/// Scheme → Edit Scheme → Run → Environment Variables), which is how a debug
/// build points at staging or a Vercel preview without a code change. It has
/// to be https: App Transport Security refuses plain http, and loosening that
/// is an Info.plist exception this app deliberately doesn't carry.
enum AppConfig {
  static let productionURL = URL(string: "https://tapworship.com")!

  static var baseURL: URL {
    #if DEBUG
    if let raw = ProcessInfo.processInfo.environment["TAPWORSHIP_API_URL"],
       let url = URL(string: raw), url.scheme == "https" {
      return url
    }
    #endif
    return productionURL
  }
}
