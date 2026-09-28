"use client";
// Create tab (admins only): define weekly set templates, run the
// auto-scheduler, and see who has finished entering availability.
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import AttentionDot from "@/components/common/AttentionDot";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Checkbox from "@/components/common/Checkbox";
import DateSelect, { toYmd } from "@/components/common/DateSelect";
import Input from "@/components/common/Input";
import InfoTooltip from "@/components/common/InfoTooltip";
import Select from "@/components/common/Select";
import LoadingDots from "@/components/common/LoadingDots";
import Modal from "@/components/common/Modal";
import AvailabilityCalendar from "@/components/AvailabilityCalendar";
import { usePageLoading } from "@/components/LoadingProvider";
import TemplateModal from "@/components/TemplateModal";
import GenerateModal, {
  type GenerateOptions,
  type TemplateColors,
} from "@/components/GenerateModal";
import StagedScheduleModal from "@/components/StagedScheduleModal";
import { DAY_LABELS } from "@/lib/constants";
import {
  DEFAULT_TEAM_ROLES,
  slottedRoles,
  resolveTeamCapacities,
  type TeamRoleDef,
} from "@/lib/teamRoles";
import { minutesToTimeLabel, shortRangeLabel } from "@/lib/dates";
import { fetchJsonArray, orgHeaders } from "@/lib/api";
import { requestTargetsTeams } from "@/lib/availabilityTargets";
import { fetchSlackStatus } from "@/lib/slackStatus";
import { useOrgs } from "@/components/OrgProvider";
import type {
  ApiAdminUser,
  ApiAvailabilityRequest,
  ApiSetTemplate,
  ApiTeam,
  StagedPlan,
  StagedSet,
} from "@/lib/types";

// Max rows the Recurring table shows per page.
const TEMPLATES_PER_PAGE = 4;

// One-line "team shape" summary for the templates list, e.g.
// "2× Electric Guitar, no Acoustic Guitar". Only lists roles that differ from
// the TEAM's own default so common templates stay uncluttered; "" when
// all-default. Roles are per-team, so the comparison needs that team's catalog.
function capacitiesSummary(
  caps: ApiSetTemplate["slotCapacities"],
  catalog: TeamRoleDef[]
): string {
  if (!caps) return "";
  const defaults = resolveTeamCapacities(catalog, null);
  const parts: string[] = [];
  for (const role of slottedRoles(catalog)) {
    const n = caps[role.key];
    if (n === undefined || n === defaults[role.key]) continue;
    parts.push(n === 0 ? `no ${role.label}` : `${n}× ${role.label}`);
  }
  return parts.join(", ");
}

type AdminUnavailabilityEntry = ApiAdminUser["unavailability"][number];

export default function CreatePage() {
  const { status } = useSession();
  const [templates, setTemplates] = useState<ApiSetTemplate[] | null>(null);
  const [users, setUsers] = useState<ApiAdminUser[] | null>(null);
  // All availability requests + which one the status panel is filtered to.
  const [requests, setRequests] = useState<ApiAvailabilityRequest[] | null>(
    null
  );
  const [statusRequestId, setStatusRequestId] = useState<string>("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  // Slack "remind everyone to fill in availability" confirm flow.
  const [remindOpen, setRemindOpen] = useState(false);
  const [remindBusy, setRemindBusy] = useState(false);
  const [remindResult, setRemindResult] = useState("");
  // "Delete this request" confirm flow on the same card. Destructive — the
  // delete cascades to everyone's answers — so it never fires from the button.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteResult, setDeleteResult] = useState("");
  // Which control is mid-update (inline dots) — never a full-page loader.
  const [busyAction, setBusyAction] = useState<
    "generate" | "apply" | "request" | null
  >(null);
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);
  const [generateResult, setGenerateResult] = useState("");
  // The proposed schedule awaiting the admin's review (null = not staging).
  const [stagedPlan, setStagedPlan] = useState<StagedPlan | null>(null);
  // Per-recurring-set tints chosen in the options dialog, handed to the review
  // modal so each set type's cards read as a block. Preview-only: they aren't
  // posted anywhere and are forgotten when the review closes.
  const [planColors, setPlanColors] = useState<TemplateColors>({});
  // The "add weekly set time" popup (opened by "Add" on the templates card).
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  // The row that popup is EDITING (null = it's adding new times instead).
  const [editingTemplate, setEditingTemplate] = useState<ApiSetTemplate | null>(
    null
  );
  // Which page of the Recurring table is shown (4 rows per page).
  const [templatePage, setTemplatePage] = useState(0);
  // The "Auto schedule" options dialog. Its scope + template picks live inside
  // it (see GenerateModal) — the page only needs to know it's open.
  const [generateOpen, setGenerateOpen] = useState(false);

  // "Request availabilities" form state. `reqTeamIds` = the teams to ask;
  // it defaults to every team in the org once the team list loads.
  const [reqName, setReqName] = useState("");
  const [reqStart, setReqStart] = useState("");
  const [reqEnd, setReqEnd] = useState("");
  const [reqResult, setReqResult] = useState("");
  const [teams, setTeams] = useState<ApiTeam[] | null>(null);
  const [reqTeamIds, setReqTeamIds] = useState<string[]>([]);

  // Everything on this page operates on ONE org: the navbar switcher's admin
  // selection. Every admin API call names it via the x-org-id header.
  const { adminOrgId, isAdminAny } = useOrgs();

  // Whether this org has Slack connected — gates the "Remind on Slack" button
  // (a reminder DMs members through the org's bot, so it's useless without one).
  const [orgSlackConnected, setOrgSlackConnected] = useState(false);
  useEffect(() => {
    if (!adminOrgId) return;
    setOrgSlackConnected(false);
    fetchSlackStatus(adminOrgId).then((s) => setOrgSlackConnected(s.enabled));
  }, [adminOrgId]);

  const reload = useCallback(async () => {
    if (!adminOrgId) return;
    const init = { headers: orgHeaders(adminOrgId) };
    // Resolve to [] on any error so the page always renders instead of
    // hanging on the loading screen forever when an endpoint fails.
    const [tpl, us, reqs, tms] = await Promise.all([
      fetchJsonArray<ApiSetTemplate>("/api/admin/templates", init),
      fetchJsonArray<ApiAdminUser>("/api/admin/users", init),
      fetchJsonArray<ApiAvailabilityRequest>(
        "/api/admin/availability-request",
        init
      ),
      fetchJsonArray<ApiTeam>(`/api/teams?orgId=${adminOrgId}`),
    ]);
    setTemplates(tpl);
    setUsers(us);
    setRequests(reqs);
    setTeams(tms);
    // A new request asks the whole org by default — every team pre-checked.
    setReqTeamIds(tms.map((t) => t.id));
    // Default the status filter to the newest request (list is newest-first).
    // Reset on an org switch — the previous org's request id means nothing here.
    setStatusRequestId(reqs[0]?.id || "");
  }, [adminOrgId]);

  // `reload`'s identity only changes when adminOrgId does, so this fires on an
  // org switch (not the in-place reloads mutations trigger). Blank the page
  // first so the full-page loader covers the swap and the previous org's data
  // never lingers on screen; reload() then refills everything as one unit.
  useEffect(() => {
    setTemplates(null);
    setUsers(null);
    setRequests(null);
    setTeams(null);
    reload();
  }, [reload]);

  // Full-page loader only for the initial load — never for mutations.
  usePageLoading(
    status === "loading" ||
      (isAdminAny &&
        !!adminOrgId &&
        (!templates || !users || !requests || !teams))
  );

  if (status === "loading") return null;
  // Non-admins never see the tab in the navbar, but guard direct visits too.
  if (!isAdminAny) {
    return <p className="text-gray-500">You need admin access for this page.</p>;
  }

  async function removeTemplate(id: string) {
    setBusyTemplateId(id);
    try {
      await fetch(`/api/admin/templates/${id}`, { method: "DELETE" });
      await reload();
    } finally {
      setBusyTemplateId(null);
    }
  }

  // Delete the request the status card is showing. Fired from the confirm
  // modal, never straight from the button: the row cascades to its responses
  // and to every SPECIFIC unavailability block entered against it.
  // reload() re-points the status filter at the newest remaining request, so
  // there's no stale id to clean up here.
  async function deleteRequest() {
    if (!selectedRequestId) return;
    setDeleteBusy(true);
    setDeleteResult("");
    try {
      const res = await fetch(
        `/api/admin/availability-request/${selectedRequestId}`,
        { method: "DELETE", headers: orgHeaders(adminOrgId) }
      );
      if (res.ok) {
        setDeleteOpen(false);
        await reload();
      } else {
        setDeleteResult("Could not delete this request.");
      }
    } catch {
      setDeleteResult("Could not delete this request.");
    } finally {
      setDeleteBusy(false);
    }
  }

  // Re-send the Slack DM asking everyone (with Slack linked) to fill in the
  // selected request. Fired from the confirm modal on the status card.
  async function sendReminder() {
    if (!selectedRequestId) return;
    setRemindBusy(true);
    setRemindResult("");
    try {
      const res = await fetch(
        `/api/admin/availability-request/${selectedRequestId}/remind`,
        { method: "POST", headers: orgHeaders(adminOrgId) }
      );
      // No success confirmation (the DM speaks for itself); only surface errors.
      setRemindResult(res.ok ? "" : "Could not send the reminder.");
    } catch {
      setRemindResult("Could not send the reminder.");
    } finally {
      setRemindBusy(false);
      setRemindOpen(false);
    }
  }

  // Ask the selected teams to submit availability over a date range. Everyone
  // on those teams who hasn't responded sees a reminder dot + banner until
  // they do (roles don't matter — being on the team is enough).
  async function requestAvailability() {
    if (!reqStart) return;
    setBusyAction("request");
    setReqResult("");
    try {
      const res = await fetch("/api/admin/availability-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orgHeaders(adminOrgId) },
        body: JSON.stringify({
          name: reqName,
          startDate: reqStart,
          // No end date → a single-day request (defaults to the start date).
          endDate: reqEnd || reqStart,
          // Only these teams' members are asked. Omitted when the org has no
          // teams at all, which the API reads as "everyone in the org".
          ...(teams && teams.length > 0 ? { teamIds: reqTeamIds } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setReqName("");
        // Clear the dates too, so the form doesn't sit there looking like it's
        // still holding an unsent request. (The pair of fields never did this;
        // with one range field the leftover "Sep 27 – Oct 27" is the most
        // prominent thing on the card.)
        setReqStart("");
        setReqEnd("");
        // Refresh so the status card's Request dropdown picks up (and selects)
        // the just-created request without a page reload.
        await reload();
      }
      setReqResult(
        res.ok
          ? "Availability request sent to the team."
          : `Error: ${data.error ?? "unknown"}`
      );
    } finally {
      setBusyAction(null);
    }
  }

  // Step 1 — dry run: expand templates + auto-assign, but persist nothing.
  // The proposal opens in the review modal for the admin to tweak.
  // Step 1 — the dry run. `opts` comes straight from the options dialog, which
  // has already checked that the window and template picks are complete. On
  // success the options dialog closes and the review modal takes over; on
  // failure it stays open showing why, with the picks intact.
  async function generate(opts: GenerateOptions, colors: TemplateColors) {
    setBusyAction("generate");
    setGenerateResult("");
    setPlanColors(colors);
    try {
      const res = await fetch("/api/admin/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orgHeaders(adminOrgId) },
        body: JSON.stringify(opts),
      });
      const data = await res.json();
      if (res.ok) {
        setGenerateOpen(false);
        setStagedPlan(data as StagedPlan);
      } else {
        setGenerateResult(`Error: ${data.error ?? "unknown"}`);
      }
    } finally {
      setBusyAction(null);
    }
  }

  // Step 2 — commit the reviewed plan. This is what actually creates the sets
  // + PENDING assignments (and, later, sends the emails/Slack messages).
  async function applyPlan(sets: StagedSet[]) {
    setBusyAction("apply");
    try {
      const res = await fetch("/api/admin/generate/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orgHeaders(adminOrgId) },
        body: JSON.stringify({ sets }),
      });
      const data = await res.json();
      setGenerateResult(
        res.ok
          ? `Created ${data.setsCreated} sets and ${data.assignmentsCreated} assignments.`
          : `Error: ${data.error ?? "unknown"}`
      );
      if (res.ok) setStagedPlan(null);
      await reload();
    } finally {
      setBusyAction(null);
    }
  }

  if (!templates || !users || !requests || !teams) return null;

  // Human label for a request in the TimeRange dropdown.
  function requestLabel(r: ApiAvailabilityRequest): string {
    const range = shortRangeLabel(r.startDate, r.endDate);
    return r.name ? `${r.name} — ${range}` : range;
  }

  function formatUnavailability(entry: AdminUnavailabilityEntry): string {
    if (entry.type === "RECURRING") {
      const base = `Every ${DAY_LABELS[entry.dayOfWeek!]} from ${minutesToTimeLabel(entry.startMinute!)} to ${minutesToTimeLabel(entry.endMinute!)}`;
      // A recurring block can repeat over a limited span; say which if it does.
      const day = (value: string) => new Date(value).toLocaleDateString();
      if (entry.startDate && entry.endDate) {
        return `${base} (${day(entry.startDate)} – ${day(entry.endDate)})`;
      }
      if (entry.startDate) return `${base} (from ${day(entry.startDate)})`;
      if (entry.endDate) return `${base} (until ${day(entry.endDate)})`;
      return base;
    }
    if (entry.type === "SPECIFIC") {
      return `${new Date(entry.startDate!).toLocaleDateString()} ${minutesToTimeLabel(entry.startMinute!)} to ${minutesToTimeLabel(entry.endMinute!)}`;
    }
    return `${new Date(entry.startDate!).toLocaleDateString()} to ${new Date(entry.endDate!).toLocaleDateString()} ${minutesToTimeLabel(entry.startMinute!)} to ${minutesToTimeLabel(entry.endMinute!)}`;
  }

  const selectedRequestId = statusRequestId || requests[0]?.id || "";
  const selectedRequest = requests.find((r) => r.id === selectedRequestId) ?? null;
  // Only the people the selected request actually asked: members of its
  // targeted teams (no teams = it went to the whole org). Roles don't matter —
  // being on the team is what puts someone on the hook.
  const askedUsers = users.filter((u) =>
    requestTargetsTeams(
      selectedRequest?.teams?.map((t) => t.id) ?? [],
      u.teams.map((t) => t.id)
    )
  );
  const sortedUsers = [...askedUsers].sort((a, b) => {
    const aDone = Boolean(
      a.availabilityResponses.find(
        (r) => r.requestId === selectedRequestId && r.completedAt
      )
    );
    const bDone = Boolean(
      b.availabilityResponses.find(
        (r) => r.requestId === selectedRequestId && r.completedAt
      )
    );
    if (aDone !== bDone) return aDone ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  const selectedUser = sortedUsers.find((u) => u.id === selectedUserId) ?? null;
  // Their response to the request on screen — whether they've submitted, and
  // the note they left with it.
  const selectedResponse =
    selectedUser?.availabilityResponses.find(
      (r) => r.requestId === selectedRequestId
    ) ?? null;
  // The teams the selected request asked (empty = it went to the whole org).
  const selectedRequestTeams = selectedRequest?.teams ?? [];
  // Everything of this person's that TOUCHES the request's window — matched by
  // DATE, not by requestId. Days painted on the availability calendar are saved
  // standalone (requestId null — see /api/availability/block-days), so the old
  // `requestId === selected` test on SPECIFIC blocks hid exactly the individual
  // dates an admin opens this modal to see. Sorted for reading: the weekly
  // blocks first (in weekday order), then the one-off dates in date order.
  const visibleUnavailability: AdminUnavailabilityEntry[] = selectedUser && selectedRequest
    ? selectedUser.unavailability
        .filter((entry) => {
          const reqStart = new Date(selectedRequest.startDate);
          const reqEnd = new Date(selectedRequest.endDate);
          if (entry.type === "RECURRING") {
            // Repeats forever unless it was given a span; when it has one,
            // it's only relevant if that span overlaps the request's window.
            if (entry.endDate && new Date(entry.endDate) < reqStart) return false;
            if (entry.startDate && new Date(entry.startDate) > reqEnd) return false;
            return true;
          }
          if (!entry.startDate) return false;
          const start = new Date(entry.startDate);
          const end = entry.endDate ? new Date(entry.endDate) : start;
          return start <= reqEnd && end >= reqStart;
        })
        .sort((a, b) => {
          if (a.type === "RECURRING" || b.type === "RECURRING") {
            if (a.type !== b.type) return a.type === "RECURRING" ? -1 : 1;
            return (a.dayOfWeek ?? 0) - (b.dayOfWeek ?? 0);
          }
          return (a.startDate ?? "").localeCompare(b.startDate ?? "");
        })
    : [];

  // Paginate the templates table. Clamp the page here (instead of storing the
  // clamped value) so deleting the last row of the final page can't strand the
  // view on an empty page.
  const templatePageCount = Math.max(
    1,
    Math.ceil(templates.length / TEMPLATES_PER_PAGE)
  );
  const currentTemplatePage = Math.min(templatePage, templatePageCount - 1);
  // Ordered Monday→Sunday (day 0=Sun, so shift to a Mon-first index), then by
  // start time within a day, so the list stays in weekly order as rows are added.
  const orderedTemplates = [...templates].sort((a, b) => {
    const dayA = (a.dayOfWeek + 6) % 7;
    const dayB = (b.dayOfWeek + 6) % 7;
    return dayA - dayB || a.startMinute - b.startMinute;
  });
  const visibleTemplates = orderedTemplates.slice(
    currentTemplatePage * TEMPLATES_PER_PAGE,
    (currentTemplatePage + 1) * TEMPLATES_PER_PAGE
  );

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Create Sets</h1>

      {/* ── Recurring sets (weekly templates) ───────────────────────── */}
      <section>
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <h2 className="text-lg font-semibold">Recurring</h2>
              {/* These rows are only a shape until something expands them, and
                  the button beside this is what does it — so the explanation
                  belongs here, on the thing being expanded. */}
              <InfoTooltip text="Expands these recurring sets into concrete sets, then auto-assigns people based on the roles they play and their availability. You'll get a preview to review and tweak before anything is saved — nobody is notified until you apply. To change who's assigned on a single set, open it on the Calendar." />
            </div>
            {/* The window and the template picks are asked in the dialog, not
                parked on the page: they're answered once per run, and half of
                them only apply to one of the three scopes. */}
            <Button
              size="sm"
              onClick={() => {
                setGenerateResult("");
                setGenerateOpen(true);
              }}
              disabled={templates.length === 0}
              title={
                templates.length === 0
                  ? "Add a recurring set first."
                  : undefined
              }
            >
              Auto schedule…
            </Button>
          </div>
          {/* A failed run reports here, next to the button that started it. */}
          {generateResult && !generateOpen && (
            <p className="mb-3 text-sm font-medium text-indigo-600 dark:text-indigo-400">
              {generateResult}
            </p>
          )}
          {templates.length === 0 ? (
            <p className="text-sm text-gray-500">No templates yet.</p>
          ) : (
            // Same table styling as the "Availability status" card below.
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 text-gray-500 dark:border-gray-700">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Time</th>
                  <th className="py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleTemplates.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-gray-100 last:border-0 dark:border-gray-700/50"
                  >
                    <td className="py-2 pr-4 font-medium">
                      {t.label}
                      {t.team && (
                        <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">
                          {t.team.name}
                        </span>
                      )}
                      {(() => {
                        // Compared against the template's own team's roles.
                        const catalog =
                          teams.find((x) => x.id === t.teamId)?.roles ??
                          DEFAULT_TEAM_ROLES;
                        const summary = capacitiesSummary(t.slotCapacities, catalog);
                        return summary ? (
                          // Non-default team shape, e.g. "3× Electric Guitar".
                          <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">
                            {summary}
                          </span>
                        ) : null;
                      })()}
                    </td>
                    <td className="py-2 pr-4">
                      {/* Plural — it recurs every week (e.g. "Thursdays"). */}
                      {DAY_LABELS[t.dayOfWeek]}s · {minutesToTimeLabel(t.startMinute)}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {/* Edit reopens the add form on this row — same fields
                          (name, day, times, team, team shape), saved in place.
                          Sets already generated from it aren't rewritten; the
                          change lands on the next auto-schedule run. */}
                      <Button
                        size="sm"
                        variant="ghost"
                        // Indigo the way Delete beside it is red — the app's
                        // accent (same as the Edit action beside it).
                        className="text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                        onClick={() => {
                          setEditingTemplate(t);
                          setTemplateModalOpen(true);
                        }}
                        disabled={busyTemplateId === t.id}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                        onClick={() => removeTemplate(t.id)}
                        disabled={busyTemplateId === t.id}
                      >
                        {busyTemplateId === t.id ? <LoadingDots size="sm" /> : "Delete"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {/* Transparent full-width add row beneath the list. Keeps the
              accessible name the e2e specs click on. */}
          <button
            type="button"
            onClick={() => {
              setEditingTemplate(null);
              setTemplateModalOpen(true);
            }}
            aria-label="Add weekly set time"
            className="mt-2 w-full rounded-lg border border-dashed border-gray-300 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-200"
          >
            + Add
          </button>
          {/* Pager — only when there's more than one page of templates. */}
          {templatePageCount > 1 && (
            <div className="mt-3 flex items-center justify-end gap-3">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Page {currentTemplatePage + 1} of {templatePageCount}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setTemplatePage(currentTemplatePage - 1)}
                disabled={currentTemplatePage === 0}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setTemplatePage(currentTemplatePage + 1)}
                disabled={currentTemplatePage >= templatePageCount - 1}
              >
                Next
              </Button>
            </div>
          )}
        </Card>
      </section>

      {/* ── Request availabilities  +  Availability status (50/50) ──── */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Left: request the team to enter their availability */}
        <Card>
          <div className="mb-3 flex items-center gap-1.5">
            <h2 className="text-lg font-semibold">Request availabilities</h2>
            <InfoTooltip text="Ask the teams you pick to enter when they’re unavailable over a date range. Only their members are notified. Manage an availability request on the right panel." />
          </div>
          <div className="space-y-3">
            <Input
              label="Name (optional)"
              value={reqName}
              onChange={(e) => setReqName(e.target.value)}
              placeholder="e.g. Passion Week 2026"
            />
            {/* ONE range picker rather than a From/To pair: a window is a
                single idea, and picking it as start-then-end in one calendar
                shows the days in between highlighting as you go. The pair also
                had to police itself with min/max — each field capping the
                other — which left no room to move when both landed in the same
                month. Leaving the end unpicked still means a one-day request
                (see requestAvailability). */}
            <DateSelect
              range
              highlightToday={false}
              label="Dates to ask about"
              value={reqStart}
              endValue={reqEnd}
              min={toYmd(new Date())}
              onRangeChange={(start, end) => {
                setReqStart(start);
                setReqEnd(end);
              }}
            />
            {/* Who gets asked. Defaults to every team in the org; only members
                of the checked teams see the reminder + get the Slack DM. */}
            {teams.length > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Ask these teams
                  </span>
                  <button
                    type="button"
                    className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    onClick={() =>
                      setReqTeamIds(
                        reqTeamIds.length === teams.length
                          ? []
                          : teams.map((t) => t.id)
                      )
                    }
                  >
                    {reqTeamIds.length === teams.length
                      ? "Clear all"
                      : "Select all"}
                  </button>
                </div>
                <div className="grid max-h-28 gap-1.5 overflow-y-auto rounded-lg border border-gray-200 p-2 sm:grid-cols-2 dark:border-gray-700">
                  {teams.map((t) => (
                    <Checkbox
                      key={t.id}
                      label={t.name}
                      checked={reqTeamIds.includes(t.id)}
                      onChange={(e) =>
                        setReqTeamIds(
                          e.target.checked
                            ? [...reqTeamIds, t.id]
                            : reqTeamIds.filter((id) => id !== t.id)
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            )}
            <Button
              onClick={requestAvailability}
              disabled={
                !reqStart ||
                // Nobody to ask — the org has teams but none are checked.
                (teams.length > 0 && reqTeamIds.length === 0) ||
                busyAction === "request"
              }
            >
              {busyAction === "request" ? (
                <LoadingDots size="sm" />
              ) : (
                "Request availabilities"
              )}
            </Button>
          </div>
          {reqResult && (
            <p className="mt-3 text-sm font-medium text-indigo-600 dark:text-indigo-400">
              {reqResult}
            </p>
          )}
        </Card>

        {/* Right: who has responded, filtered by TimeRange */}
        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Availability status</h2>
            {selectedRequest && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!orgSlackConnected}
                  title={
                    orgSlackConnected
                      ? undefined
                      : "Connect Slack for this organization to send reminders."
                  }
                  onClick={() => {
                    setRemindResult("");
                    setRemindOpen(true);
                  }}
                >
                  Remind on Slack
                </Button>
                {/* Deletes whichever request the dropdown below is showing. */}
                <Button
                  size="sm"
                  variant="danger"
                  title="Delete this availability request"
                  onClick={() => {
                    setDeleteResult("");
                    setDeleteOpen(true);
                  }}
                >
                  Delete
                </Button>
              </div>
            )}
          </div>
          {remindResult && (
            <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
              {remindResult}
            </p>
          )}
          {deleteResult && (
            <p className="mb-3 text-sm text-red-600 dark:text-red-400">
              {deleteResult}
            </p>
          )}
          {requests.length > 0 && (
            <div className="mb-3">
              <Select
                label="Request Name"
                value={statusRequestId}
                onChange={(e) => setStatusRequestId(e.target.value)}
              >
                {requests.map((r) => (
                  // <option> can't contain markup (React hydration error), so
                  // plain text only — no <strong> here.
                  <option key={r.id} value={r.id}>
                    {r.name || "Availability"} (
                    {shortRangeLabel(r.startDate, r.endDate)})
                  </option>
                ))}
              </Select>
              {/* Who this request went out to — the table below lists exactly
                  those people. */}
              <p className="mt-1 text-xs text-gray-500">
                Asked:{" "}
                {selectedRequestTeams.length > 0
                  ? selectedRequestTeams.map((t) => t.name).join(", ")
                  : "everyone in the organization"}
              </p>
            </div>
          )}
          {requests.length === 0 ? (
            <p className="text-sm text-gray-500">
              No availability requests yet.
            </p>
          ) : (
            <div className="max-h-[16rem] overflow-y-scroll rounded-md">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-gray-800">
                  <tr>
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.map((u) => {
                    const done = u.availabilityResponses.find(
                      (r) => r.requestId === selectedRequestId && r.completedAt
                    );
                    // A note is the one part of a response that can't be read
                    // off a date, so it gets a dot — click the row to read it.
                    // Tracked on the response ROW, not on `done`: un-submitting
                    // keeps the note, and the modal shows it either way, so the
                    // dot has to agree or the note becomes unfindable.
                    // Deliberately no re-sorting: the list stays alphabetical /
                    // done-last so it's still scannable for who hasn't replied.
                    const hasNote = Boolean(
                      u.availabilityResponses.find(
                        (r) => r.requestId === selectedRequestId
                      )?.note
                    );
                    return (
                      <tr
                        key={u.id}
                        onClick={() => setSelectedUserId(u.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedUserId(u.id);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        className={`cursor-pointer border-b border-gray-100 last:border-0 transition-colors hover:bg-indigo-50 dark:border-gray-700/50 dark:hover:bg-indigo-900/20 ${selectedUserId === u.id ? "bg-indigo-100 dark:bg-indigo-900/20" : ""}`}
                      >
                        <td className="py-2 pr-4 font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            {u.name}
                            {hasNote && (
                              <AttentionDot label={`${u.name} left a note`} />
                            )}
                          </span>
                        </td>
                        <td className="py-2">
                          {done ? (
                            <Badge tone="green">
                              {done.edited ? "Edited " : "Done "}
                              {new Date(done.completedAt!).toLocaleDateString()}
                            </Badge>
                          ) : (
                            <Badge tone="amber">Not yet</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Step 1: the options. Step 2 (StagedScheduleModal) opens on success. */}
      <GenerateModal
        open={generateOpen}
        templates={templates}
        requests={requests}
        busy={busyAction === "generate"}
        error={generateResult}
        onGenerate={generate}
        onClose={() => setGenerateOpen(false)}
      />

      <Modal
        open={Boolean(selectedUser && selectedRequest)}
        onClose={() => setSelectedUserId(null)}
        title={`${selectedUser?.name ?? "Person"}'s unavailable times`}
      >
        {selectedUser && selectedRequest && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              {requestLabel(selectedRequest)}
            </p>
            {/* Their own words first: a note usually explains the blocks below
                it ("away the first weekend"), so reading it after them is
                reading the answer backwards. */}
            {selectedResponse?.note && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-900/20">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                  Note from {selectedUser.name}
                </p>
                {/* whitespace-pre-line: they typed it in a textarea, so keep
                    the line breaks they put there. */}
                <p className="mt-0.5 whitespace-pre-line text-sm text-gray-700 dark:text-gray-200">
                  {selectedResponse.note}
                </p>
              </div>
            )}
            {Boolean(selectedResponse?.completedAt) ? (
              visibleUnavailability.length === 0 ? (
                <p className="text-sm text-gray-500">
                  They haven&apos;t entered any unavailability blocks for this range.
                </p>
              ) : (
                <>
                  {/* Which DAYS are out, at a glance — a wall of "every Monday
                      from…" lines never answered that. Read-only, opened on the
                      request's first month, and keyed on the request so picking
                      another one re-seeds the month instead of keeping this. */}
                  <AvailabilityCalendar
                    key={selectedRequest.id}
                    entries={visibleUnavailability}
                    initialMonth={new Date(selectedRequest.startDate)}
                    compact
                  />
                  <ul className="space-y-2">
                    {visibleUnavailability.map((entry) => (
                      <li
                        key={entry.id}
                        className="rounded-md bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800/60"
                      >
                        <div>{formatUnavailability(entry)}</div>
                        {entry.note && (
                          <div className="mt-1 text-xs text-gray-500">
                            {entry.note}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )
            ) : (
              <p className="text-sm text-gray-500">
                They haven&apos;t submitted availability for this time range yet.
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={remindOpen}
        onClose={() => setRemindOpen(false)}
        title="Remind on Slack"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setRemindOpen(false)}
              disabled={remindBusy}
            >
              Cancel
            </Button>
            <Button onClick={sendReminder} disabled={remindBusy}>
              {remindBusy ? <LoadingDots size="sm" /> : "Send reminder"}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-400">
          This sends a direct message on Slack to everyone this request asked
          {selectedRequestTeams.length > 0
            ? ` (${selectedRequestTeams.map((t) => t.name).join(", ")})`
            : ""}{" "}
          who has Slack linked, asking them to fill out their availability for{" "}
          <strong>
            {selectedRequest
              ? `${selectedRequest.name || "Availability"} (${shortRangeLabel(
                  selectedRequest.startDate,
                  selectedRequest.endDate
                )})`
              : "this request"}
          </strong>
          .
        </p>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete availability request"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={deleteRequest}
              disabled={deleteBusy}
            >
              {deleteBusy ? <LoadingDots size="sm" /> : "Delete request"}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-400">
          This permanently deletes{" "}
          <strong>
            {selectedRequest
              ? `${selectedRequest.name || "Availability"} (${shortRangeLabel(
                  selectedRequest.startDate,
                  selectedRequest.endDate
                )})`
              : "this request"}
          </strong>
          , along with everything people entered against it &mdash; their
          unavailable dates for this range and their &ldquo;done&rdquo; status.
          Recurring weekly unavailability is not affected. This cannot be
          undone.
        </p>
      </Modal>

      <TemplateModal
        open={templateModalOpen}
        template={editingTemplate}
        teams={teams}
        onClose={() => {
          setTemplateModalOpen(false);
          setEditingTemplate(null);
        }}
        onCreated={reload}
      />

      <StagedScheduleModal
        plan={stagedPlan}
        colors={planColors}
        users={users}
        teams={teams}
        busy={busyAction === "apply"}
        onApply={applyPlan}
        onClose={() => setStagedPlan(null)}
      />
    </div>
  );
}
