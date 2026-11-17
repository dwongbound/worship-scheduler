import Foundation
import Security
import TapWorshipKit

/// The signed-in session, kept in the Keychain — never UserDefaults, which is
/// a plain file in the app's container and is included in unencrypted
/// backups.
///
/// `AfterFirstUnlockThisDeviceOnly`: readable once the phone has been unlocked
/// since boot (so a background refresh can use it later), and never migrated
/// to another device by a backup restore — a new phone signs in again.
struct SessionStore: Sendable {
  private let service = "com.tapworship.session"
  private let account = "current"

  /// The session this launch signed in with, held in memory as well. If the
  /// Keychain write fails (an unsigned build, or a locked keychain) the app
  /// still has its token until it quits, instead of signing in and then
  /// 401ing on every request.
  private static let memory = MemoryCopy()

  func load() -> MobileSession? {
    keychainLoad() ?? Self.memory.value
  }

  private func keychainLoad() -> MobileSession? {
    var query = baseQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
          let data = item as? Data
    else { return nil }
    return try? TapWorship.makeDecoder().decode(MobileSession.self, from: data)
  }

  func save(_ session: MobileSession) {
    clear()
    Self.memory.value = session
    guard let data = try? TapWorship.makeEncoder().encode(session) else { return }
    var item = baseQuery
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(item as CFDictionary, nil)
  }

  func clear() {
    Self.memory.value = nil
    SecItemDelete(baseQuery as CFDictionary)
  }

  private var baseQuery: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }
}

/// A lock-guarded slot, so the API client's token closure can read it from
/// any thread.
private final class MemoryCopy: @unchecked Sendable {
  private let lock = NSLock()
  private var stored: MobileSession?

  var value: MobileSession? {
    get { lock.withLock { stored } }
    set { lock.withLock { stored = newValue } }
  }
}
