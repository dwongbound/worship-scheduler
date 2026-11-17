import SwiftUI
import TapWorshipKit

/// Covers and swaps waiting on an admin: the web's Approvals tab. The seats
/// already show the new person (the web works the same way); approving makes
/// it final, rejecting puts the seat back.
///
/// Approve is one swipe because it's the common answer and it's what the
/// seat already shows. Reject asks first: it moves someone off a set.
struct ApprovalsView: View {
  @Environment(AppModel.self) private var model

  @State private var items: [ApiApproval] = []
  @State private var phase: Phase = .loading
  @State private var busy: Set<String> = []
  @State private var confirmReject: ApiApproval?
  @State private var actionError: String?
  @State private var decided = 0

  enum Phase: Equatable { case loading, loaded, failed(String) }

  var body: some View {
    NavigationStack {
      content
        .navigationTitle("Approvals")
        .toolbar { AdminOrgPicker() }
        .navigationDestination(for: String.self) { id in
          ApprovalDetailView(
            approval: items.first { $0.id == id },
            busy: busy.contains(id),
            decide: decide,
            askReject: { confirmReject = $0 }
          )
        }
        .refreshable { await load() }
        .task(id: model.adminOrgID) { await load() }
        .confirmationDialog(
          "Reject this handoff?",
          isPresented: Binding(get: { confirmReject != nil }, set: { if !$0 { confirmReject = nil } }),
          titleVisibility: .visible,
          presenting: confirmReject
        ) { approval in
          Button("Reject", role: .destructive) { Task { await decide(approval, .reject) } }
          Button("Close", role: .cancel) {}
        } message: { approval in
          Text(rejectMessage(approval))
        }
        .alert("Couldn't save that", isPresented: Binding(
          get: { actionError != nil },
          set: { if !$0 { actionError = nil } }
        ), actions: {
          Button("OK") { actionError = nil }
        }, message: { Text(actionError ?? "") })
        .sensoryFeedback(.success, trigger: decided)
    }
  }

  @ViewBuilder private var content: some View {
    switch phase {
    case .loading where items.isEmpty:
      List { ForEach(AdminPreviewData.approvals) { ApprovalRow(approval: $0) } }
        .redacted(reason: .placeholder)
        .disabled(true)
        .accessibilityLabel("Loading approvals")
    case .failed(let message) where items.isEmpty:
      ContentUnavailableView {
        Label("Couldn't load approvals", systemImage: "wifi.exclamationmark")
      } description: {
        Text(message)
      } actions: {
        Button("Try Again") { Task { await load() } }
          .buttonStyle(.borderedProminent)
      }
    default:
      if items.isEmpty {
        ContentUnavailableView {
          Label("Nothing to approve", systemImage: "checkmark.seal")
        } description: {
          Text("When someone covers a set or two people trade, it waits here for you.")
        }
      } else {
        List {
          Section {
            ForEach(items) { approval in
              NavigationLink(value: approval.id) {
                ApprovalRow(approval: approval, busy: busy.contains(approval.id))
              }
              .swipeActions(edge: .leading) {
                Button("Approve") { Task { await decide(approval, .approve) } }
                  .tint(.green)
              }
              .swipeActions(edge: .trailing) {
                Button("Reject") { confirmReject = approval }
                  .tint(.red)
              }
              .disabled(busy.contains(approval.id))
            }
          } footer: {
            Text("Swipe right to approve, left to reject.")
          }
        }
        .listStyle(.insetGrouped)
      }
    }
  }

  private func rejectMessage(_ approval: ApiApproval) -> String {
    switch approval {
    case .cover(_, _, _, let taker, let owner, _):
      "\(taker.name) comes off the set and the seat goes back to \(owner?.name ?? "its owner")."
    case .swap(_, _, _, let requester, let recipient, _, _):
      "\(requester.name) and \(recipient.name) go back to their own sets."
    }
  }

  private func load() async {
    guard let orgId = await model.currentAdminOrgID() else {
      phase = .failed("Couldn't find the orgs you look after.")
      return
    }
    do {
      let fresh = try await model.api.approvals(orgId: orgId)
      withAnimation(.smooth) { items = fresh.sorted { $0.firstDate < $1.firstDate } }
      model.pendingApprovals = fresh.count
      phase = .loaded
    } catch {
      if let message = model.handle(error) { phase = .failed(message) }
    }
  }

  /// The row leaves as soon as the server says yes, with the list's own
  /// removal animation; a reload afterwards catches anything else that moved.
  private func decide(_ approval: ApiApproval, _ decision: ApprovalDecision) async {
    guard let orgId = model.adminOrgID else { return }
    busy.insert(approval.id)
    defer { busy.remove(approval.id) }
    do {
      try await model.api.decide(approval, decision, orgId: orgId)
      withAnimation(.smooth) { items.removeAll { $0.id == approval.id } }
      model.pendingApprovals = items.count
      decided += 1
    } catch {
      actionError = model.handle(error)
    }
    await load()
  }
}

struct ApprovalRow: View {
  let approval: ApiApproval
  var busy = false

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      Image(systemName: approval.kind == "swap" ? "arrow.left.arrow.right" : "person.badge.shield.checkmark")
        .foregroundStyle(.tint)
        .frame(width: 24)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 4) {
        Text(approval.summary)
          .font(.headline)
        Text(approval.firstDate, format: .dateTime.weekday(.abbreviated).month().day().hour().minute())
          .font(.subheadline)
          .foregroundStyle(.secondary)
        if let reason = approval.reason, !reason.isEmpty {
          Text("“\(reason)”")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(2)
        }
      }
      Spacer(minLength: 0)
      if busy { ProgressView() }
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }
}

/// One handoff in full, with the two answers as real buttons for anyone who
/// doesn't swipe.
struct ApprovalDetailView: View {
  let approval: ApiApproval?
  let busy: Bool
  let decide: (ApiApproval, ApprovalDecision) async -> Void
  let askReject: (ApiApproval) -> Void

  var body: some View {
    if let approval {
      List {
        Section {
          Text(approval.summary).font(.headline)
          LabeledContent("Role", value: RoleLabels.label(for: approval.role))
          if let reason = approval.reason, !reason.isEmpty {
            LabeledContent("Reason") { Text(reason) }
          }
        }
        switch approval {
        case .cover(_, _, _, let taker, let owner, let set):
          Section("Set") { SetRefRow(set: set) }
          Section {
            LabeledContent("Was", value: owner?.name ?? "Unknown")
            LabeledContent("Now", value: taker.name)
          } footer: {
            Text("The seat already shows \(taker.name). Approving makes it final.")
          }
        case .swap(_, _, _, let requester, let recipient, let receive, let giveUp):
          Section("\(recipient.name) takes") { SetRefRow(set: receive) }
          Section("\(requester.name) takes") { SetRefRow(set: giveUp) }
        }
        Section {
          Button {
            Task { await decide(approval, .approve) }
          } label: {
            ZStack {
              Text("Approve").bold().opacity(busy ? 0 : 1)
              if busy { ProgressView().accessibilityLabel("Saving") }
            }
            .frame(maxWidth: .infinity, minHeight: 44)
          }
          .buttonStyle(.borderedProminent)
          .tint(.green)
          .listRowInsets(EdgeInsets())
          .listRowBackground(Color.clear)

          Button("Reject", role: .destructive) { askReject(approval) }
            .frame(maxWidth: .infinity, minHeight: 44)
            .buttonStyle(.bordered)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }
        .disabled(busy)
        .listRowSeparator(.hidden)
      }
      .listStyle(.insetGrouped)
      .navigationTitle(approval.kind == "swap" ? "Swap" : "Cover")
      .navigationBarTitleDisplayMode(.inline)
    } else {
      // Decided (here or on the web) while this screen was open.
      ContentUnavailableView("Already handled", systemImage: "checkmark.circle",
                             description: Text("This one has been approved or rejected."))
    }
  }
}

struct SetRefRow: View {
  let set: ApprovalSetRef

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(set.startsAt, format: .dateTime.weekday(.wide).month().day())
        .font(.body.weight(.medium))
      Text("\(set.startsAt.formatted(date: .omitted, time: .shortened)) · \(set.label ?? "Set")")
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }
    .accessibilityElement(children: .combine)
  }
}

/// The org switcher both admin tabs share. Hidden with one org, since a menu
/// of one choice is noise.
struct AdminOrgPicker: ToolbarContent {
  @Environment(AppModel.self) private var model

  var body: some ToolbarContent {
    ToolbarItem(placement: .topBarTrailing) {
      if let orgs = model.adminOrgs, orgs.count > 1 {
        Menu {
          Picker("Org", selection: Binding(get: { model.adminOrgID }, set: { model.adminOrgID = $0 })) {
            ForEach(orgs) { Text($0.orgName).tag(Optional($0.orgId)) }
          }
        } label: {
          Label(model.adminOrg?.orgName ?? "Org", systemImage: "building.2")
            .labelStyle(.titleAndIcon)
        }
        .accessibilityLabel("Org: \(model.adminOrg?.orgName ?? "none")")
      }
    }
  }
}

#Preview("Approvals") {
  ApprovalsView()
    .environment(AppModel.adminPreview())
}

#Preview("Approvals · empty") {
  ApprovalsView()
    .environment(AppModel.adminPreview(approvals: "[]"))
}

#Preview("Approvals · error, dark") {
  ApprovalsView()
    .environment(AppModel.adminPreview(failWith: APIError.network("The Internet connection appears to be offline.")))
    .preferredColorScheme(.dark)
}

#Preview("Approvals · largest text") {
  ApprovalsView()
    .environment(AppModel.adminPreview())
    .dynamicTypeSize(.accessibility5)
}
