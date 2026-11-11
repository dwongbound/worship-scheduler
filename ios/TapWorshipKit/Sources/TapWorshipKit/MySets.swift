import Foundation

// My Sets — GET /api/assignments, and the three things a person can do to one
// of their own seats (PATCH /api/assignments/:id). Mirrors
// components/MySetsPanel.tsx so the phone and the web offer the same buttons.

/// The set an assignment sits on, as /api/assignments sends it: the set row
/// plus its org, WITHOUT the roster (so not an `ApiSet`, whose `assignments`
/// is required).
public struct ApiMySet: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let label: String?
  public let startsAt: Date
  public let durationMinutes: Int
  public let notes: String?
  public let isPrivate: Bool?
  public let org: ApiOrgRef?

  public var endsAt: Date { startsAt.addingTimeInterval(TimeInterval(durationMinutes * 60)) }
}

public struct PendingSwapRef: Codable, Hashable, Sendable {
  public let proposalId: String
  /// I started it (so I can cancel it), rather than being asked.
  public let isRequester: Bool
}

public struct ApiMyAssignment: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let role: RoleKey
  public let status: AssignmentStatus
  public let set: ApiMySet
  /// Present only on PENDING_SWAP rows.
  public let pendingSwap: PendingSwapRef?
}

/// The body of PATCH /api/assignments/:id.
public enum AssignmentAction: String, Codable, Sendable, CaseIterable {
  case confirm
  case requestSwap
  case cancelSwap

  /// The button's words — the web's, so one person on two devices reads one
  /// vocabulary.
  public var title: String {
    switch self {
    case .confirm: "Confirm"
    case .requestSwap: "Request cover"
    case .cancelSwap: "Cancel cover"
    }
  }
}

public enum MySets {
  /// lib/constants.ts STATUS_LABELS.
  public static func statusLabel(_ status: AssignmentStatus) -> String {
    switch status {
    case .pending: "Pending confirmation"
    case .confirmed: "Confirmed"
    case .swapRequested: "Requesting cover"
    case .pendingSwap: "Pending swap"
    case .pendingApproval: "Pending approval"
    }
  }

  /// Which actions a seat offers, in the web's order: Confirm only while
  /// pending, and Request cover everywhere except on a seat already asking —
  /// where it becomes Cancel cover.
  public static func actions(for status: AssignmentStatus) -> [AssignmentAction] {
    var out: [AssignmentAction] = []
    if status == .pending { out.append(.confirm) }
    out.append(status == .swapRequested ? .cancelSwap : .requestSwap)
    return out
  }

  /// Needs the person's answer: the same rows the web's "Unconfirmed first"
  /// sort lifts.
  public static func needsAttention(_ a: ApiMyAssignment) -> Bool {
    a.status == .pending
  }

  /// One row per SET, not per seat: a person playing keys and singing on the
  /// same set sees that set once with both roles, as the web groups them.
  public struct SetGroup: Hashable, Identifiable, Sendable {
    public let set: ApiMySet
    public let seats: [ApiMyAssignment]
    public var id: String { self.set.id }
    public var needsAttention: Bool { seats.contains(where: MySets.needsAttention) }
  }

  public static func grouped(_ assignments: [ApiMyAssignment]) -> [SetGroup] {
    var order: [String] = []
    var bySet: [String: (ApiMySet, [ApiMyAssignment])] = [:]
    for a in assignments {
      if bySet[a.set.id] == nil {
        order.append(a.set.id)
        bySet[a.set.id] = (a.set, [])
      }
      bySet[a.set.id]!.1.append(a)
    }
    return order
      .compactMap { bySet[$0] }
      .map { SetGroup(set: $0.0, seats: $0.1) }
      .sorted { ($0.set.startsAt, $0.set.id) < ($1.set.startsAt, $1.set.id) }
  }
}

/// lib/teamRoles.ts `roleLabel` without a catalog — which is how the web's My
/// Sets names a role too (/api/assignments sends no team catalog).
public enum RoleLabels {
  public static let builtIn: [RoleKey: String] = [
    "WORSHIP_LEADER": "Worship Leader",
    "VOCALS": "Vox",
    "ACOUSTIC_GUITAR": "Acoustic Guitar",
    "ELECTRIC_GUITAR": "Electric Guitar",
    "KEYS": "Keys",
    "STRINGS": "Strings",
    "DRUMS": "Drums",
    "BASS": "Bass",
    "AV": "A/V",
    "CHOIR": "Choir",
  ]

  public static func label(for key: RoleKey, in catalog: [TeamRoleDef]? = nil) -> String {
    if let own = catalog?.first(where: { $0.key == key }) { return own.label }
    if let known = builtIn[key] { return known }
    return humanize(key)
  }

  /// "SOUND_BOOTH" → "Sound Booth".
  static func humanize(_ key: String) -> String {
    key.split(whereSeparator: { $0 == "_" || $0.isWhitespace })
      .map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }
      .joined(separator: " ")
  }
}
