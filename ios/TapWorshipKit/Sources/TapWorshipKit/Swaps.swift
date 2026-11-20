import Foundation

// Covers and swaps, the member's side: open cover requests I could take
// (GET /api/swaps), trades someone has asked me for
// (GET /api/swaps/proposals/incoming) and the picker for proposing one of my
// own (GET /api/swaps/candidates). Mirrors components/MySetsPanel.tsx.

/// Someone else's seat that is asking for cover, in a role I play.
public struct ApiOpenCover: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let role: RoleKey
  /// The owner's note, if they left one.
  public let reason: String?
  public let set: ApiMySet
  /// Who is asking.
  public let user: ApiUserRef

  public init(id: String, role: RoleKey, reason: String? = nil, set: ApiMySet, user: ApiUserRef) {
    self.id = id
    self.role = role
    self.reason = reason
    self.set = set
    self.user = user
  }
}

/// One side of a trade: just enough of a set to name it.
public struct SwapSetRef: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let label: String?
  public let startsAt: Date
  public let org: ApiOrgRef?

  public init(id: String, label: String? = nil, startsAt: Date, org: ApiOrgRef? = nil) {
    self.id = id
    self.label = label
    self.startsAt = startsAt
    self.org = org
  }
}

/// A trade someone has asked ME for: I'd give up one set and take theirs.
public struct ApiSwapProposal: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let role: RoleKey
  public let requestedBy: ApiUserRef
  public let reason: String?
  /// My set, which they'd take.
  public let giveUp: SwapSetRef
  /// Their set, which I'd take.
  public let receive: SwapSetRef

  public init(id: String, role: RoleKey, requestedBy: ApiUserRef, reason: String? = nil, giveUp: SwapSetRef, receive: SwapSetRef) {
    self.id = id
    self.role = role
    self.requestedBy = requestedBy
    self.reason = reason
    self.giveUp = giveUp
    self.receive = receive
  }
}

public enum SwapAnswer: String, Codable, Sendable {
  case accept, reject
}

public struct SwapCandidateSet: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let label: String?
  public let startsAt: Date
  public let durationMinutes: Int

  public init(id: String, label: String? = nil, startsAt: Date, durationMinutes: Int) {
    self.id = id
    self.label = label
    self.startsAt = startsAt
    self.durationMinutes = durationMinutes
  }
}

/// A seat I could trade mine for: same team, same role, someone else's.
public struct ApiSwapCandidate: Codable, Hashable, Identifiable, Sendable {
  public let toAssignmentId: String
  public let role: RoleKey
  public let counterparty: ApiUserRef
  public let set: SwapCandidateSet
  /// Am I free for their set?
  public let youAvailable: Bool
  /// Are they free for mine?
  public let theyAvailable: Bool
  public let theyInactive: Bool
  /// Roles each side already holds on the other's set.
  public let theyAlsoOnYourSet: [RoleKey]
  public let youAlsoOnTheirSet: [RoleKey]

  public var id: String { toAssignmentId }

  public init(
    toAssignmentId: String, role: RoleKey, counterparty: ApiUserRef, set: SwapCandidateSet,
    youAvailable: Bool = true, theyAvailable: Bool = true, theyInactive: Bool = false,
    theyAlsoOnYourSet: [RoleKey] = [], youAlsoOnTheirSet: [RoleKey] = []
  ) {
    self.toAssignmentId = toAssignmentId
    self.role = role
    self.counterparty = counterparty
    self.set = set
    self.youAvailable = youAvailable
    self.theyAvailable = theyAvailable
    self.theyInactive = theyInactive
    self.theyAlsoOnYourSet = theyAlsoOnYourSet
    self.youAlsoOnTheirSet = youAlsoOnTheirSet
  }
}

public struct SwapCandidatePage: Codable, Hashable, Sendable {
  public let items: [ApiSwapCandidate]
  public let hasMore: Bool

  public init(items: [ApiSwapCandidate], hasMore: Bool) {
    self.items = items
    self.hasMore = hasMore
  }
}

public enum Swaps {
  /// How serious a warning on a trade is. A seat someone already holds is a
  /// fact (red); an availability block is an intention (amber).
  public enum Severity: String, Sendable { case fact, intention, note }

  public struct Warning: Hashable, Identifiable, Sendable {
    public let severity: Severity
    public let text: String
    public var id: String { text }
  }

  static func roleList(_ roles: [RoleKey]) -> String {
    roles.map { RoleLabels.label(for: $0) }.joined(separator: ", ")
  }

  /// What the picker says about one candidate, most serious first. Never a
  /// blocker: the person proposing decides.
  public static func warnings(for c: ApiSwapCandidate) -> [Warning] {
    var out: [Warning] = []
    if !c.youAlsoOnTheirSet.isEmpty {
      out.append(Warning(severity: .fact, text: "You're already on that set (\(roleList(c.youAlsoOnTheirSet)))"))
    }
    if !c.theyAlsoOnYourSet.isEmpty {
      out.append(Warning(severity: .fact, text: "\(c.counterparty.name) is already on your set (\(roleList(c.theyAlsoOnYourSet)))"))
    }
    if !c.youAvailable {
      out.append(Warning(severity: .intention, text: "You've marked yourself unavailable then"))
    }
    if !c.theyAvailable {
      out.append(Warning(severity: .intention, text: "\(c.counterparty.name) is unavailable for your set"))
    }
    if c.theyInactive {
      out.append(Warning(severity: .note, text: "\(c.counterparty.name) is inactive on this team"))
    }
    return out
  }

  /// Clean trades first, then by date: the ones most likely to be accepted
  /// are the ones worth reading first.
  public static func ranked(_ candidates: [ApiSwapCandidate]) -> [ApiSwapCandidate] {
    func weight(_ c: ApiSwapCandidate) -> Int {
      let w = warnings(for: c)
      if w.contains(where: { $0.severity == .fact }) { return 2 }
      if w.contains(where: { $0.severity == .intention }) { return 1 }
      return 0
    }
    return candidates.sorted { (weight($0), $0.set.startsAt, $0.id) < (weight($1), $1.set.startsAt, $1.id) }
  }

  /// How many things on My Sets are waiting on me from other people.
  public static func waitingCount(covers: [ApiOpenCover], proposals: [ApiSwapProposal]) -> Int {
    covers.count + proposals.count
  }

  public static func candidatesPath(assignmentId: String, skip: Int, take: Int = 20) -> String {
    "/api/swaps/candidates?assignmentId=\(assignmentId)&skip=\(skip)&take=\(take)"
  }

  /// A note as the server wants it: trimmed, nil when blank.
  public static func cleanNote(_ text: String) -> String? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : String(trimmed.prefix(500))
  }
}

extension APIClient {
  /// Open cover requests I could take, soonest first.
  public func openCovers() async throws -> [ApiOpenCover] {
    try await send("GET", "/api/swaps")
  }

  /// Take someone's seat. It shows me at once but waits on an admin.
  public func takeCover(_ assignmentId: String) async throws {
    let _: Ignored = try await send("POST", "/api/swaps/\(assignmentId)/take")
  }

  /// "Not me": takes the request off my list and tells the owner.
  public func declineCover(_ assignmentId: String, note: String? = nil) async throws {
    struct Body: Encodable { let note: String? }
    let _: Ignored = try await send("POST", "/api/swaps/\(assignmentId)/decline", body: Body(note: note))
  }

  public func incomingSwaps() async throws -> [ApiSwapProposal] {
    try await send("GET", "/api/swaps/proposals/incoming")
  }

  public func answerSwap(_ proposalId: String, _ answer: SwapAnswer, note: String? = nil) async throws {
    struct Body: Encodable { let action: SwapAnswer; let note: String? }
    let _: Ignored = try await send("POST", "/api/swaps/proposals/\(proposalId)/respond", body: Body(action: answer, note: note))
  }

  /// Take back a trade I proposed.
  public func withdrawSwap(_ proposalId: String) async throws {
    let _: Ignored = try await send("DELETE", "/api/swaps/proposals/\(proposalId)")
  }

  public func swapCandidates(for assignmentId: String, skip: Int = 0, take: Int = 20) async throws -> SwapCandidatePage {
    try await send("GET", Swaps.candidatesPath(assignmentId: assignmentId, skip: skip, take: take))
  }

  public func proposeSwap(from assignmentId: String, to targetAssignmentId: String, reason: String? = nil) async throws {
    struct Body: Encodable { let fromAssignmentId: String; let toAssignmentId: String; let reason: String? }
    let _: Ignored = try await send(
      "POST", "/api/swaps/propose",
      body: Body(fromAssignmentId: assignmentId, toAssignmentId: targetAssignmentId, reason: reason)
    )
  }
}
