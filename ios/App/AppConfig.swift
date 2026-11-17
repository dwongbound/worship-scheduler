import Foundation
import TapWorshipKit

/// Where the app's API lives.
///
/// Release builds always talk to production. A Debug build can be pointed at
/// a dev server two ways: `./use-env dev` (reads the web app's env/dev.env),
/// or `TAPWORSHIP_API_URL` on the Xcode scheme for a one-off like a Vercel
/// preview. Anything on the internet has to be https; plain http is allowed
/// only for localhost and the local network, which is all the debug-only
/// App Transport Security allowance in Config/Info-Debug.plist covers.
enum AppConfig {
  static let productionURL = URL(string: "https://tapworship.com")!

  /// The iOS OAuth client from Google Cloud (Credentials → Create OAuth
  /// client ID → iOS, with this app's bundle id), e.g.
  /// `123-abc.apps.googleusercontent.com`. Not a secret: it ships in every
  /// copy of the app. The server must list the same id in
  /// `GOOGLE_IOS_CLIENT_ID`. Nil hides the Google button.
  static let releaseGoogleIOSClientID: String? = nil

  /// A debug build uses the one `./use-env` copied out of the env file, so a
  /// dev server and the app agree without editing this file.
  static var googleIOSClientID: String? {
    #if DEBUG
    if let dev = DevServer.clientID(debugValue("TapWorshipGoogleClientID")) { return dev }
    #endif
    return releaseGoogleIOSClientID
  }

  #if DEBUG
  /// A value `Config/Info-Debug.plist` carries in from the xcconfig.
  private static func debugValue(_ key: String) -> String? {
    Bundle.main.object(forInfoDictionaryKey: key) as? String
  }
  #endif

  /// The clock the server judges availability on (its `APP_TZ`). A blocked
  /// day is stored as midnight HERE, so the Availability tab reads days in
  /// this zone wherever the phone is; set times stay in the phone's own zone,
  /// as they do in a browser.
  static let appTimeZone = TimeZone(identifier: "America/Los_Angeles") ?? .current

  /// A Sunday-first calendar on the app's clock.
  static let appCalendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = appTimeZone
    calendar.firstWeekday = 1
    return calendar
  }()

  /// Production, unless this is a debug build that was pointed elsewhere:
  /// by the scheme's `TAPWORSHIP_API_URL`, or by `./use-env dev` (which reads
  /// the web app's env/dev.env). Plain http is accepted for this Mac and the
  /// local network only; see `DevServer`.
  static var baseURL: URL {
    #if DEBUG
    if let url = DevServer.url(ProcessInfo.processInfo.environment["TAPWORSHIP_API_URL"]) { return url }
    if let url = DevServer.url(debugValue("TapWorshipAPIURL")) { return url }
    #endif
    return productionURL
  }

  /// True when this build isn't talking to production: the sign-in screen
  /// says so, so a dev build is never mistaken for the real thing.
  static var isDevServer: Bool { baseURL != productionURL }

  /// Flip to true when the app is ready to change things on tapworship.com.
  /// Until then a build pointed at production is a read-only preview: the
  /// API client refuses every write (TapWorshipKit `ReadOnly`) and the
  /// screens hide the buttons that would make one. Dev servers are unaffected.
  static let allowProductionWrites = false

  static var readOnly: Bool {
    #if DEBUG
    // Try the preview against a dev server: TAPWORSHIP_READ_ONLY=1 on the scheme.
    if ProcessInfo.processInfo.environment["TAPWORSHIP_READ_ONLY"] == "1" { return true }
    #endif
    return !isDevServer && !allowProductionWrites
  }
}
