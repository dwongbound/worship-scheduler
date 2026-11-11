import SwiftUI
import TapWorshipKit

/// The sets I'm on, soonest first — the phone's version of the web's My Sets.
/// Sets that still need my answer get their own section on top, which is the
/// web's "Unconfirmed first" sort made the default: on a phone, that's the
/// reason to open the app.
struct MySetsView: View {
  @Environment(AppModel.self) private var model

  @State private var groups: [MySets.SetGroup] = []
  @State private var phase: Phase = .loading
  @State private var actionError: String?
  @State private var coverFor: ApiMyAssignment?

  enum Phase: Equatable { case loading, loaded, failed(String) }

  private var needsAnswer: [MySets.SetGroup] { groups.filter(\.needsAttention) }
  private var upcoming: [MySets.SetGroup] { groups.filter { !$0.needsAttention } }

  var body: some View {
    NavigationStack {
      content
        .navigationTitle("My Sets")
        .navigationDestination(for: MySets.SetGroup.self) { group in
          SetSeatsView(groupID: group.id, groups: groups, act: act, requestCover: { coverFor = $0 })
        }
        .refreshable { await load() }
        .task { if phase == .loading { await load() } }
        .sheet(item: $coverFor) { seat in
          RequestCoverSheet(seat: seat) { reason in
            await act(seat, .requestSwap, reason: reason)
          }
        }
        .alert("Couldn't save that", isPresented: Binding(
          get: { actionError != nil },
          set: { if !$0 { actionError = nil } }
        ), actions: {
          Button("OK") { actionError = nil }
        }, message: { Text(actionError ?? "") })
    }
  }

  @ViewBuilder private var content: some View {
    switch phase {
    case .loading where groups.isEmpty:
      List { ForEach(PreviewData.groups) { SetRow(group: $0) } }
        .redacted(reason: .placeholder)
        .disabled(true)
        .accessibilityLabel("Loading your sets")
    case .failed(let message) where groups.isEmpty:
      ContentUnavailableView {
        Label("Couldn't load your sets", systemImage: "wifi.exclamationmark")
      } description: {
        Text(message)
      } actions: {
        Button("Try Again") { Task { await load() } }
          .buttonStyle(.borderedProminent)
      }
    default:
      if groups.isEmpty {
        ContentUnavailableView {
          Label("No upcoming sets", systemImage: "calendar")
        } description: {
          Text(model.session?.user.hasNoOrg == true
               ? "You're not in an org yet. Join one with its key on tapworship.com."
               : "When you're scheduled on a set, it shows up here.")
        }
      } else {
        list
      }
    }
  }

  private var list: some View {
    List {
      if !needsAnswer.isEmpty {
        Section {
          ForEach(needsAnswer) { group in
            NavigationLink(value: group) { SetRow(group: group) }
              .swipeActions(edge: .leading) {
                Button("Confirm") { Task { await confirmAll(group) } }
                  .tint(.green)
              }
          }
        } header: {
          Text("Needs your answer")
        } footer: {
          Text("Swipe right on a set to confirm it.")
        }
      }
      if !upcoming.isEmpty {
        Section("Upcoming") {
          ForEach(upcoming) { group in
            NavigationLink(value: group) { SetRow(group: group) }
          }
        }
      }
    }
    .listStyle(.insetGrouped)
  }

  private func load() async {
    do {
      groups = MySets.grouped(try await model.api.myAssignments())
      phase = .loaded
    } catch {
      if let message = model.handle(error) { phase = .failed(message) }
    }
  }

  private func confirmAll(_ group: MySets.SetGroup) async {
    for seat in group.seats where seat.status == .pending {
      await act(seat, .confirm, reason: nil)
    }
  }

  /// Acts, then reloads from the server rather than guessing the new state:
  /// a cover request can land on PENDING_APPROVAL or a swap, and the server
  /// is the one that knows which.
  private func act(_ seat: ApiMyAssignment, _ action: AssignmentAction, reason: String?) async {
    do {
      try await model.api.act(on: seat.id, action, reason: reason)
    } catch {
      actionError = model.handle(error)
    }
    await load()
  }
}

/// One set: when, what, which org, and my seat(s) on it.
struct SetRow: View {
  let group: MySets.SetGroup

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(group.set.startsAt, format: .dateTime.weekday(.wide).month().day())
        .font(.headline)
      Text("\(group.set.startsAt.formatted(date: .omitted, time: .shortened)) · \(group.set.label ?? "Set")")
        .font(.subheadline)
      if let org = group.set.org?.name {
        Text(org)
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      ForEach(group.seats) { seat in
        HStack(spacing: 6) {
          Text(RoleLabels.label(for: seat.role))
            .font(.footnote.weight(.medium))
          StatusPill(status: seat.status)
        }
      }
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }
}

/// The web's StatusBadge colours, as a pill. Colour is never the only signal:
/// the words are always there.
struct StatusPill: View {
  let status: AssignmentStatus

  private var tint: Color {
    switch status {
    case .pending, .pendingApproval: .orange
    case .confirmed: .green
    case .swapRequested: .red
    case .pendingSwap: .blue
    }
  }

  var body: some View {
    Text(MySets.statusLabel(status))
      .font(.caption.weight(.medium))
      .padding(.horizontal, 8)
      .padding(.vertical, 2)
      .foregroundStyle(tint)
      .background(tint.opacity(0.15), in: Capsule())
  }
}

/// A set's detail: each of my seats on it, with the buttons the web offers.
struct SetSeatsView: View {
  let groupID: String
  let groups: [MySets.SetGroup]
  let act: (ApiMyAssignment, AssignmentAction, String?) async -> Void
  let requestCover: (ApiMyAssignment) -> Void

  @State private var busy: String?
  @State private var confirmCancel: ApiMyAssignment?

  /// Read from the live list, so the page reflects a reload after acting.
  private var group: MySets.SetGroup? { groups.first { $0.id == groupID } }

  var body: some View {
    if let group {
      List {
        Section {
          LabeledContent("Date", value: group.set.startsAt.formatted(.dateTime.weekday(.wide).month(.wide).day()))
          LabeledContent("Time", value: "\(group.set.startsAt.formatted(date: .omitted, time: .shortened)) – \(group.set.endsAt.formatted(date: .omitted, time: .shortened))")
          if let org = group.set.org?.name { LabeledContent("Org", value: org) }
        }
        if let notes = group.set.notes, !notes.isEmpty {
          Section("Notes") { Text(notes) }
        }
        ForEach(group.seats) { seat in
          Section {
            HStack {
              Text(RoleLabels.label(for: seat.role)).font(.headline)
              Spacer()
              StatusPill(status: seat.status)
            }
            ForEach(MySets.actions(for: seat.status), id: \.self) { action in
              Button(role: action == .cancelSwap ? .destructive : nil) {
                switch action {
                case .confirm: run(seat, .confirm)
                case .requestSwap: requestCover(seat)
                case .cancelSwap: confirmCancel = seat
                }
              } label: {
                HStack {
                  Text(action.title)
                  Spacer()
                  if busy == seat.id { ProgressView() }
                }
                .frame(minHeight: 44)
              }
              .disabled(busy != nil)
            }
          }
        }
      }
      .listStyle(.insetGrouped)
      .navigationTitle(group.set.label ?? "Set")
      .navigationBarTitleDisplayMode(.inline)
      .confirmationDialog(
        "Cancel your cover request?",
        isPresented: Binding(
          get: { confirmCancel != nil },
          set: { if !$0 { confirmCancel = nil } }
        ),
        titleVisibility: .visible,
        presenting: confirmCancel
      ) { seat in
        Button("Cancel cover", role: .destructive) { run(seat, .cancelSwap) }
        Button("Keep asking", role: .cancel) { confirmCancel = nil }
      } message: { _ in
        Text("You'll be back on this set, and you'll still need to confirm it.")
      }
    } else {
      ContentUnavailableView("This set is no longer on your list", systemImage: "calendar.badge.minus")
    }
  }

  private func run(_ seat: ApiMyAssignment, _ action: AssignmentAction) {
    confirmCancel = nil
    busy = seat.id
    Task {
      await act(seat, action, nil)
      busy = nil
    }
  }
}

/// "Request cover", with the optional note the web's prompt asks for.
struct RequestCoverSheet: View {
  let seat: ApiMyAssignment
  let submit: (String?) async -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var reason = ""
  @State private var sending = false
  @FocusState private var focused: Bool

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Optional, e.g. \"Out of town that weekend\"", text: $reason, axis: .vertical)
            .lineLimit(3...6)
            .focused($focused)
        } header: {
          Text("Note for your team")
        } footer: {
          Text("Everyone who plays \(RoleLabels.label(for: seat.role)) on your team is asked to take this seat.")
        }
      }
      .navigationTitle("Request cover")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          if sending {
            ProgressView()
          } else {
            Button("Send") {
              sending = true
              Task {
                let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
                await submit(trimmed.isEmpty ? nil : trimmed)
                dismiss()
              }
            }
          }
        }
      }
      .interactiveDismissDisabled(sending)
      .onAppear { focused = true }
    }
    .presentationDetents([.medium, .large])
  }
}

#Preview("My Sets") {
  MySetsView()
    .environment(AppModel.preview(signedIn: true))
}

#Preview("My Sets · dark, largest text") {
  MySetsView()
    .environment(AppModel.preview(signedIn: true))
    .preferredColorScheme(.dark)
    .dynamicTypeSize(.accessibility5)
}

#Preview("My Sets · empty") {
  MySetsView()
    .environment(AppModel.preview(signedIn: true, assignments: []))
}

#Preview("My Sets · offline") {
  MySetsView()
    .environment(AppModel.preview(signedIn: true, failWith: URLError(.notConnectedToInternet)))
}
