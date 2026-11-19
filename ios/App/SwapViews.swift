import SwiftUI
import TapWorshipKit

/// Someone asking for cover in a role I play: who, when, their note, and the
/// two answers.
struct OpenCoverRow: View {
  let cover: ApiOpenCover
  let busy: Bool
  let take: () -> Void
  let decline: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      VStack(alignment: .leading, spacing: 4) {
        Text("\(cover.user.name) needs cover on \(RoleLabels.label(for: cover.role))")
          .font(.headline)
        Text(cover.set.startsAt, format: .dateTime.weekday(.wide).month().day())
          .font(.subheadline)
        Text("\(cover.set.startsAt.formatted(date: .omitted, time: .shortened)) · \(cover.set.label ?? "Set")")
          .font(.subheadline)
          .foregroundStyle(.secondary)
        if let org = cover.set.org?.name {
          Text(org).font(.footnote).foregroundStyle(.secondary)
        }
        if let reason = cover.reason, !reason.isEmpty {
          Text("“\(reason)”")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
      .accessibilityElement(children: .combine)

      AnswerButtons(yes: "Take it", no: "Not me", busy: busy, onYes: take, onNo: decline)
    }
    .padding(.vertical, 4)
  }
}

/// A trade someone has asked me for: what I'd give up, what I'd take.
struct SwapProposalRow: View {
  let proposal: ApiSwapProposal
  let busy: Bool
  let answer: (SwapAnswer) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      VStack(alignment: .leading, spacing: 4) {
        Text("\(proposal.requestedBy.name) wants to swap \(RoleLabels.label(for: proposal.role))")
          .font(.headline)
        LabeledContent("You give up", value: when(proposal.giveUp))
        LabeledContent("You take", value: when(proposal.receive))
        if let reason = proposal.reason, !reason.isEmpty {
          Text("“\(reason)”")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
      .font(.subheadline)
      .accessibilityElement(children: .combine)

      AnswerButtons(yes: "Accept", no: "Decline", busy: busy, onYes: { answer(.accept) }, onNo: { answer(.reject) })
    }
    .padding(.vertical, 4)
  }

  private func when(_ set: SwapSetRef) -> String {
    "\(set.startsAt.formatted(.dateTime.weekday(.abbreviated).month().day())) · \(set.label ?? "Set")"
  }
}

/// A yes and a no, side by side where they fit and stacked where they don't
/// (the largest text sizes). 44pt tall either way.
struct AnswerButtons: View {
  let yes: String
  let no: String
  let busy: Bool
  let onYes: () -> Void
  let onNo: () -> Void

  var body: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 8) { buttons }
      VStack(spacing: 8) { buttons }
    }
  }

  @ViewBuilder private var buttons: some View {
    Button(action: onNo) {
      Text(no).frame(maxWidth: .infinity, minHeight: 30)
    }
    .buttonStyle(.bordered)
    Button(action: onYes) {
      ZStack {
        Text(yes).bold().opacity(busy ? 0 : 1)
        if busy { ProgressView().accessibilityLabel("Saving") }
      }
      .frame(maxWidth: .infinity, minHeight: 30)
    }
    .buttonStyle(.borderedProminent)
  }
}

/// Trade one of my seats for someone else's: pick their set, add a note,
/// send. They answer on their own My Sets, and an admin approves after that.
struct SwapPickerSheet: View {
  let seat: ApiMyAssignment
  /// Runs once a request has been sent, so the list behind reloads.
  let sent: () async -> Void

  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss

  @State private var candidates: [ApiSwapCandidate] = []
  @State private var hasMore = false
  @State private var phase: Phase = .loading
  @State private var loadingMore = false

  enum Phase: Equatable { case loading, loaded, failed(String) }

  var body: some View {
    NavigationStack {
      content
        .animation(.smooth(duration: 0.3), value: phase)
        .navigationTitle("Swap \(RoleLabels.label(for: seat.role))")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Close") { dismiss() }
          }
        }
        .navigationDestination(for: ApiSwapCandidate.self) { candidate in
          SwapConfirmView(seat: seat, candidate: candidate) {
            await sent()
            dismiss()
          }
        }
        .task { if phase == .loading { await load(reset: true) } }
    }
  }

  @ViewBuilder private var content: some View {
    switch phase {
    case .loading:
      ProgressView("Finding sets you could trade for")
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    case .failed(let message):
      ContentUnavailableView {
        Label("Couldn't load sets to swap with", systemImage: "wifi.exclamationmark")
      } description: {
        Text(message)
      } actions: {
        Button("Try Again") { Task { await load(reset: true) } }
          .buttonStyle(.borderedProminent)
      }
    case .loaded:
      if candidates.isEmpty {
        ContentUnavailableView {
          Label("No one to swap with", systemImage: "arrow.left.arrow.right")
        } description: {
          Text("Nobody else on your team is playing \(RoleLabels.label(for: seat.role)) on an upcoming set. You can request cover instead.")
        }
      } else {
        List { Group {
          Section {
            ForEach(candidates) { candidate in
              NavigationLink(value: candidate) {
                SwapCandidateRow(candidate: candidate)
              }
            }
            if hasMore {
              HStack {
                Spacer()
                ProgressView()
                Spacer()
              }
              .task { await load(reset: false) }
            }
          } header: {
            Text("Your \(seat.set.startsAt.formatted(.dateTime.weekday(.abbreviated).month().day())) set for…")
          }
        }
.listRowBackground(Color.twCard)
}
        .listStyle(.insetGrouped)
        .twList()
      }
    }
  }

  private func load(reset: Bool) async {
    if !reset {
      guard !loadingMore else { return }
      loadingMore = true
    }
    defer { loadingMore = false }
    do {
      let page = try await model.api.swapCandidates(for: seat.id, skip: reset ? 0 : candidates.count)
      // The server pages soonest first; warnings are worth reading on each
      // row, but re-sorting across pages would move rows under a thumb.
      candidates = reset ? page.items : candidates + page.items.filter { fresh in !candidates.contains { $0.id == fresh.id } }
      hasMore = page.hasMore && !page.items.isEmpty
      phase = .loaded
    } catch {
      if let message = model.handle(error) {
        if reset { phase = .failed(message) } else { hasMore = false }
      }
    }
  }
}

struct SwapCandidateRow: View {
  let candidate: ApiSwapCandidate

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(candidate.set.startsAt, format: .dateTime.weekday(.wide).month().day())
        .font(.headline)
      Text("\(candidate.set.startsAt.formatted(date: .omitted, time: .shortened)) · \(candidate.set.label ?? "Set")")
        .font(.subheadline)
      Text("With \(candidate.counterparty.name)")
        .font(.subheadline)
        .foregroundStyle(.secondary)
      ForEach(Swaps.warnings(for: candidate)) { warning in
        SwapWarningLabel(warning: warning)
      }
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }
}

/// Red for a seat someone already holds, amber for "said they can't", grey
/// for a note. The icon and the words carry it too, never colour alone.
struct SwapWarningLabel: View {
  let warning: Swaps.Warning

  var body: some View {
    Label(warning.text, systemImage: icon)
      .font(.footnote)
      .foregroundStyle(color)
  }

  private var icon: String {
    switch warning.severity {
    case .fact: "exclamationmark.triangle.fill"
    case .intention: "calendar.badge.exclamationmark"
    case .note: "info.circle"
    }
  }

  private var color: Color {
    switch warning.severity {
    case .fact: .red
    case .intention: .orange
    case .note: .secondary
    }
  }
}

/// The last look before a swap request goes out.
struct SwapConfirmView: View {
  let seat: ApiMyAssignment
  let candidate: ApiSwapCandidate
  let finished: () async -> Void

  @Environment(AppModel.self) private var model
  @State private var note = ""
  @State private var sending = false
  @State private var problem: String?

  var body: some View {
    Form { Group {
      Section {
        LabeledContent("You give up", value: when(seat.set.startsAt, seat.set.label))
        LabeledContent("You take", value: when(candidate.set.startsAt, candidate.set.label))
        LabeledContent("With", value: candidate.counterparty.name)
      }
      let warnings = Swaps.warnings(for: candidate)
      if !warnings.isEmpty {
        Section("Before you send") {
          ForEach(warnings) { SwapWarningLabel(warning: $0) }
        }
      }
      Section {
        TextField("Optional", text: $note, axis: .vertical)
          .lineLimit(2...5)
      } header: {
        Text("Note for \(candidate.counterparty.name)")
      } footer: {
        Text("\(candidate.counterparty.name) accepts or declines, then an admin approves the trade.")
      }
      Section {
        Button {
          send()
        } label: {
          ZStack {
            Text("Send swap request").opacity(sending ? 0 : 1)
            if sending { ProgressView().tint(.white).accessibilityLabel("Sending") }
          }
        }
        .buttonStyle(ActionButtonStyle(kind: .primary))
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
        .disabled(sending)
      } footer: {
        if let problem {
          Text(problem).foregroundStyle(.red)
        }
      }
    }
.listRowBackground(Color.twCard)
}.twList()
    .navigationTitle("Send request")
    .navigationBarTitleDisplayMode(.inline)
    .navigationBarBackButtonHidden(sending)
    .interactiveDismissDisabled(sending)
  }

  private func when(_ date: Date, _ label: String?) -> String {
    "\(date.formatted(.dateTime.weekday(.abbreviated).month().day())) · \(label ?? "Set")"
  }

  private func send() {
    sending = true
    problem = nil
    Task {
      do {
        try await model.api.proposeSwap(from: seat.id, to: candidate.toAssignmentId, reason: Swaps.cleanNote(note))
        await finished()
      } catch {
        // Stay here with the reason: "that seat was just taken" is something
        // to read, not a sheet that vanished.
        problem = model.handle(error)
        sending = false
      }
    }
  }
}

#Preview("Swap picker") {
  SwapPickerSheet(seat: PreviewData.assignments[1]) {}
    .environment(AppModel.fullPreview())
}

#Preview("Swap picker · dark, largest text") {
  SwapPickerSheet(seat: PreviewData.assignments[1]) {}
    .environment(AppModel.fullPreview())
    .preferredColorScheme(.dark)
    .dynamicTypeSize(.accessibility5)
}

#Preview("Swap picker · nobody") {
  SwapPickerSheet(seat: PreviewData.assignments[1]) {}
    .environment(AppModel.fullPreview(candidates: #"{"items":[],"hasMore":false}"#))
}

#Preview("Swap picker · offline") {
  SwapPickerSheet(seat: PreviewData.assignments[1]) {}
    .environment(AppModel.fullPreview(failWith: URLError(.notConnectedToInternet)))
}
