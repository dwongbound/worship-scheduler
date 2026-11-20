import AuthenticationServices
import SwiftUI
import TapWorshipKit

/// Import from Google Calendar, like the web's: pick calendars (nothing
/// ticked to start; reading someone's diary is a choice), preview what would
/// be blocked, import. The first time it sends you to Google once to allow
/// reading; after that it never asks again.
struct GoogleImportView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.webAuthenticationSession) private var webAuth

  let request: ApiAvailabilityRequest
  /// Called after an import, so the page reloads its blocks.
  let imported: () async -> Void

  enum Step: Equatable { case loading, consent, pick, failed(String) }

  @State private var step: Step = .loading
  @State private var calendars: [GoogleImport.Calendar] = []
  @State private var chosen: Set<String> = []
  @State private var preview: [GoogleImport.Window]?
  @State private var previewing = false
  @State private var importing = false
  @State private var connecting = false
  @State private var done = 0

  var body: some View {
    NavigationStack {
      Group {
        switch step {
        case .loading:
          List { Group {
            Section { ForEach(0..<3, id: \.self) { _ in Label("A calendar name", systemImage: "square") } }
          }
          .listRowBackground(Color.twCard)
          }
          .twList()
          .skeleton("Reading your calendars")
        case .consent:
          BrandedEmpty(title: "Allow TapWorship to read your calendar",
                       systemImage: "calendar.badge.plus",
                       message: "Once only. We only read when you're busy, never what an event is.") {
            Button {
              Task { await connect() }
            } label: {
              ZStack {
                Text("Continue with Google").opacity(connecting ? 0 : 1)
                if connecting { ProgressView() }
              }
            }
            .buttonStyle(.borderedProminent)
            .disabled(connecting)
          }
        case .failed(let message):
          BrandedEmpty(title: "Couldn't reach Google Calendar", systemImage: "wifi.exclamationmark", message: message) {
            Button("Try Again") { Task { await loadCalendars() } }
              .buttonStyle(.borderedProminent)
          }
        case .pick:
          pickList
        }
      }
      .animation(.easeInOut(duration: 0.3), value: step)
      .navigationTitle("Import from Google")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }.disabled(importing)
        }
        if step == .pick {
          ToolbarItem(placement: .confirmationAction) {
            if importing {
              ProgressView()
            } else {
              Button("Import") { Task { await runImport() } }
                .disabled(chosen.isEmpty)
            }
          }
        }
      }
      .interactiveDismissDisabled(importing)
      .sensoryFeedback(.success, trigger: done)
      .task { await loadCalendars() }
    }
  }

  private var pickList: some View {
    List { Group {
      Section {
        ForEach(calendars) { cal in
          Button {
            if chosen.contains(cal.id) { chosen.remove(cal.id) } else { chosen.insert(cal.id) }
          } label: {
            HStack {
              Image(systemName: chosen.contains(cal.id) ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(chosen.contains(cal.id) ? Color.accentColor : Color.secondary)
                .font(.title3)
              Text(cal.name)
              if cal.primary {
                Text("Main").font(TW.caption).foregroundStyle(.secondary)
              }
              Spacer()
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityAddTraits(chosen.contains(cal.id) ? .isSelected : [])
        }
      } header: {
        HStack {
          Text("Calendars")
          Spacer()
          Button(chosen.isEmpty ? "Select all" : "Deselect all") {
            chosen = chosen.isEmpty ? Set(calendars.map(\.id)) : []
          }
          .font(TW.subheadline)
          .textCase(nil)
        }
      }

      if !chosen.isEmpty {
        Section {
          if previewing && preview == nil {
            ForEach(0..<3, id: \.self) { _ in
              LabeledContent("Tue, Nov 24", value: "9 AM – 5 PM")
            }
            .skeleton("Previewing")
          } else if let preview {
            if preview.isEmpty {
              Text("Nothing to block in \(request.name ?? "this window").").foregroundStyle(.secondary)
            }
            ForEach(GoogleImport.byDay(preview), id: \.ymd) { day in
              LabeledContent(dayText(day.ymd), value: day.windows.map(windowText).joined(separator: ", "))
            }
          }
        } header: {
          Text("Will block")
        }
      }
    }
    .listRowBackground(Color.twCard)
    }
    .listStyle(.insetGrouped)
    .twList()
    .task(id: chosen) { await loadPreview() }
  }

  // MARK: Steps

  private func loadCalendars() async {
    step = .loading
    do {
      switch try await model.api.importCalendars(requestId: request.id) {
      case .needsConsent: withAnimation { step = .consent }
      case .ok(let list):
        calendars = list.sorted { ($0.primary ? 0 : 1, $0.name) < ($1.primary ? 0 : 1, $1.name) }
        withAnimation { step = .pick }
      }
    } catch {
      if let message = model.handle(error) { step = .failed(message) }
    }
  }

  private func loadPreview() async {
    guard !chosen.isEmpty else { preview = nil; return }
    previewing = true
    defer { previewing = false }
    // A short pause so ticking three calendars is one read, not three.
    try? await Task.sleep(for: .milliseconds(350))
    guard !Task.isCancelled else { return }
    do {
      if case .ok(let windows) = try await model.api.importPreview(requestId: request.id, calendarIds: Array(chosen)) {
        withAnimation(.easeInOut(duration: 0.3)) { preview = windows }
      } else {
        step = .consent
      }
    } catch {
      _ = model.handle(error)
    }
  }

  private func connect() async {
    connecting = true
    defer { connecting = false }
    do {
      let url = try await model.api.importAuthorizeURL(requestId: request.id)
      let back = try await webAuth.authenticate(using: url, callbackURLScheme: GoogleImport.returnScheme)
      switch GoogleImport.returnStatus(back) {
      case "connected": await loadCalendars()
      case "denied": break
      default: step = .failed("Google didn't finish connecting. Try again.")
      }
    } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
      return
    } catch {
      if let message = model.handle(error) { step = .failed(message) }
    }
  }

  private func runImport() async {
    importing = true
    defer { importing = false }
    do {
      switch try await model.api.runImport(requestId: request.id, calendarIds: Array(chosen)) {
      case .needsConsent: step = .consent
      case .ok:
        done += 1
        await imported()
        dismiss()
      }
    } catch {
      if let message = model.handle(error) { step = .failed(message) }
    }
  }

  private func dayText(_ ymd: String) -> String {
    guard let date = SetCalendar.date(ymd: ymd, calendar: AppConfig.appCalendar) else { return ymd }
    var style = Date.FormatStyle.dateTime.weekday(.abbreviated).month(.abbreviated).day()
    style.timeZone = AppConfig.appTimeZone
    return date.formatted(style)
  }

  private func windowText(_ w: GoogleImport.Window) -> String {
    if w.startMinute == 0 && w.endMinute >= Availability.fullDay { return "All day" }
    return "\(Availability.timeLabel(w.startMinute)) – \(Availability.timeLabel(w.endMinute))"
  }
}
