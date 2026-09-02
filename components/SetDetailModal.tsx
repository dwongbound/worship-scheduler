"use client";
// Modal showing a set's full team roster, grouped by role with empty slots
// visible.
//   • Admins can swap/remove/add people (any change resets that slot to
//     PENDING), auto-fill the open slots, remove individual role slots (the
//     "✕" beside each row), and edit the notes.
//   • The set's worship leader can also edit the notes.
//   • Everyone else sees it read-only.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Modal from "./common/Modal";
import Button from "./common/Button";
import Dropdown from "./common/Dropdown";
import InfoTooltip from "./common/InfoTooltip";
import LoadingDots from "./common/LoadingDots";
import Checkbox from "./common/Checkbox";
import SlackIcon from "./common/SlackIcon";
import Toast, { type ToastMessage } from "./common/Toast";
import SlotCapacityEditor from "./SlotCapacityEditor";
import StatusBadge from "./StatusBadge";
import PlayerSelect, { type PlayerOption } from "./PlayerSelect";
import {
  GROUP_CHAT_LEAD_OPTIONS,
  INSTRUMENT_LABELS,
  MAX_SONGS_PER_SET,
  MAX_SONG_TITLE_LENGTH,
  MD_ROLES,
  ROLE_ORDER,
  SONG_KEYS,
  normalizeSongKey,
  type BandRole,
  type Instrument,
} from "@/lib/constants";
import {
  DEFAULT_TEAM_ROLES,
  slottedRoles,
  resolveTeamCapacities,
  roleLabel,
  teamSupportsMD,
} from "@/lib/teamRoles";
import { formatDay, formatTime } from "@/lib/dates";
import { eligibleMDIds, isValidMD } from "@/lib/md";
import { isUserAvailable, type UnavailabilityRule } from "@/lib/scheduler";
import { buildPlayerOptions } from "@/lib/playerOptions";
import { fetchJsonArray } from "@/lib/api";
import { isUnbounded, openSeats } from "@/lib/guestTeams";
import GuestTeamsModal, { type GuestTeamDraft } from "./GuestTeamsModal";
import SetHistoryEntry from "./SetHistoryEntry";
import type {
  ApiAdminUser,
  ApiAssignment,
  ApiSet,
  ApiSetGuestTeam,
  ApiSetHistoryEvent,
  ApiTeam,
} from "@/lib/types";

interface SetDetailModalProps {
  set: ApiSet | null; // null = closed
  onClose: () => void;
  currentUserId?: string;
  isAdmin?: boolean;
  users?: ApiAdminUser[]; // for the admin assignment dropdowns
  // Every set in view (calendar's −7d…+92d window). Used to count how many
  // times each person is already scheduled within ±2 weeks of this set, which
  // orders the assignment dropdowns least-scheduled-first.
  allSets?: ApiSet[];
  onChanged?: () => void | Promise<void>; // refetch after an edit
}

// How wide a window (each side, in days) counts toward a person's recent
// scheduling load in the assignment dropdowns.
const SERVE_WINDOW_DAYS = 14;

export default function SetDetailModal({
  set,
  onClose,
  currentUserId,
  isAdmin = false,
  users = [],
  allSets = [],
  onChanged,
}: SetDetailModalProps) {
  const [notesDraft, setNotesDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Two-step delete: the button flips to "Confirm delete" before firing.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Which "Auto schedule" is in flight (busy also goes true; this picks which
  // button shows the dots). There's one per roster: "own" for the set's team,
  // and a guest row's id for each other team's block.
  const [autofilling, setAutofilling] = useState<string | null>(null);
  // Filled slot whose "✕" was clicked — a confirm modal asks before removing
  // the person along with their slot. (Empty slots are removed right away.)
  const [slotToDelete, setSlotToDelete] = useState<ApiAssignment | null>(null);
  // Slack "message team" state. The button is shown to everyone (anyone on the
  // team can start the group chat); it's disabled until this org connects Slack.
  const [slackConfigured, setSlackConfigured] = useState(false);
  // The result of the last "Slack Team" click, shown as a floating toast rather
  // than inline text — the outcome is transient, and a line of copy appearing
  // under the action bar shoved the whole modal body down.
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // Flips the Slack button to a checkmark for a moment after a successful post,
  // so the confirmation lives on the control you clicked rather than as a line
  // of text that shifts the layout.
  const [slackDone, setSlackDone] = useState(false);
  const slackDoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Don't fire setState after the modal closes mid-timeout.
  useEffect(
    () => () => {
      if (slackDoneTimer.current) clearTimeout(slackDoneTimer.current);
    },
    []
  );

  // The worship leader's setlist, edited as local draft rows ({ title, key })
  // and saved as a whole list (PUT replaces). key "" = unspecified. Synced from
  // the set below so a save-refetch (or opening another set) reflows it.
  // Each row carries a stable `id` so dnd-kit can track it across reorders
  // (existing songs reuse their db id; new blank rows get a generated one). The
  // id is local-only — saves send just { title, key }.
  const [songDraft, setSongDraft] = useState<
    { id: string; title: string; key: string }[]
  >([]);

  // "Change Roles": the stacked modal for editing this set's team shape (how
  // many of each role it wants) plus the Require-MD flag. Null = closed;
  // opening seeds the draft from the set.
  const [rolesDraft, setRolesDraft] = useState<{
    capacities: Record<BandRole, number>;
    requiresMD: boolean;
  } | null>(null);

  // "Other teams": the stacked editor for which OTHER teams lend people to this
  // set. Null = closed. The org's teams are fetched lazily the first time an
  // admin opens it — most set views never need them.
  const [guestDraft, setGuestDraft] = useState<GuestTeamDraft[] | null>(null);
  const [orgTeams, setOrgTeams] = useState<ApiTeam[] | null>(null);

  // The set's activity log (History section, bottom of the modal).
  const [history, setHistory] = useState<ApiSetHistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Keep the notes textarea in sync with whichever set is open.
  useEffect(() => {
    setNotesDraft(set?.notes ?? "");
  }, [set?.id, set?.notes]);

  // Load the songs editor whenever a (different) set opens. Keyed on the set id
  // ONLY — not set.songs — so the auto-save refetch below (same set, new object)
  // doesn't reset the draft and clobber whatever the user is mid-typing. The
  // sets list always ships each set's songs, so the id changing is enough.
  useEffect(() => {
    setSongDraft(
      (set?.songs ?? []).map((s) => ({
        id: s.id,
        title: s.title,
        key: s.key ?? "",
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set?.id]);

  // Auto-save the setlist — there's no explicit "save" button. Debounced so we
  // PUT once the user pauses (not on every keystroke), and only when the draft
  // actually differs from what's saved on the server. `runEdit` refetches the
  // set afterwards so the Spotify/history sections stay current. The row ids are
  // stripped — only { title, key } (in order) is persisted or compared.
  //
  // What we send AND compare is the draft run through the same cleaning the
  // server does (drop blank titles, trim, normalize the key — see the songs
  // PUT route). Comparing the raw draft made an unsaveable row (an empty
  // "+ Add song" row, a key with no title, a title that only trims down) look
  // like a pending change forever: we'd PUT, the server would drop it, the
  // refetch would come back without it, and the effect would fire again —
  // re-saving in a loop every 800ms for as long as the row sat there.
  const savedSongs = JSON.stringify(
    (set?.songs ?? []).map((s) => ({ title: s.title, key: s.key ?? "" }))
  );
  const draftSongs = JSON.stringify(
    songDraft
      .map((r) => ({
        title: r.title.trim().slice(0, MAX_SONG_TITLE_LENGTH),
        key: normalizeSongKey(r.key) ?? "",
      }))
      .filter((r) => r.title !== "")
  );
  const currentSongSetId = set?.id;
  useEffect(() => {
    if (!currentSongSetId || savedSongs === draftSongs) return;
    const timer = setTimeout(() => {
      runEdit(() =>
        fetch(`/api/sets/${currentSongSetId}/songs`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ songs: JSON.parse(draftSongs) }),
        })
      );
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSongSetId, savedSongs, draftSongs]);

  // Reset the delete confirmations + Slack feedback whenever a different set
  // opens (or the modal closes) — a toast about set A shouldn't outlive it.
  useEffect(() => {
    setConfirmingDelete(false);
    setSlotToDelete(null);
    setRolesDraft(null);
    setGuestDraft(null);
    setToast(null);
  }, [set?.id]);

  // The org's teams, for the guest-team picker. Fetched once the editor is
  // first opened (not on every calendar load) and only for the set's own org,
  // so another tenant's teams can never be offered as guests.
  useEffect(() => {
    if (!guestDraft || orgTeams || !set?.org?.id) return;
    let cancelled = false;
    fetchJsonArray<ApiTeam>(`/api/teams?orgId=${set.org.id}`)
      .then((teams) => !cancelled && setOrgTeams(teams))
      .catch(() => !cancelled && setOrgTeams([]));
    return () => {
      cancelled = true;
    };
  }, [guestDraft, orgTeams, set?.org?.id]);

  // Is the Slack bot configured for this org? Drives whether the "Slack Team"
  // button is enabled (it's shown to everyone regardless).
  // Only fetch while a set is actually open — this modal is always mounted (with
  // set=null) on the calendar page, so gating on `set` avoids a wasted request
  // (and a doubled one under React's dev Strict Mode) on every calendar load.
  useEffect(() => {
    if (!set) return;
    // Per-org: the "Slack Team" button only works if the set's OWN org has
    // connected Slack, so ask about that org specifically.
    fetch(`/api/slack/status?orgId=${set.org?.id ?? ""}`)
      .then((r) => r.json())
      .then((d) => setSlackConfigured(!!d.enabled))
      .catch(() => setSlackConfigured(false));
  }, [set]);

  // History section: fetched fresh whenever a (different) set opens, and
  // refreshed again after any edit made from this modal (see runEdit).
  function refetchHistory(id: string) {
    setHistoryLoading(true);
    fetch(`/api/sets/${id}/history`)
      .then((r) => r.json())
      .then((d) => setHistory(Array.isArray(d) ? d : []))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }

  const setId = set?.id;
  useEffect(() => {
    if (!setId) return;
    // A DIFFERENT set: drop the old log outright, so another set's rows can't
    // linger while this one's load is in flight. (In-place refreshes of the
    // same set deliberately keep theirs — see the History section below.)
    setHistory([]);
    refetchHistory(setId);
  }, [setId]);

  // Flatten every user's unavailability into scheduler rules once, so the
  // dropdowns can flag who can't serve at this set's time. (Hook stays above
  // the early return so hook order is stable.)
  const rules = useMemo<UnavailabilityRule[]>(
    () =>
      users.flatMap((u) =>
        u.unavailability.map((r) => ({
          userId: u.id,
          type: r.type,
          dayOfWeek: r.dayOfWeek,
          startMinute: r.startMinute,
          endMinute: r.endMinute,
          startDate: r.startDate ? new Date(r.startDate) : null,
          endDate: r.endDate ? new Date(r.endDate) : null,
        }))
      ),
    [users]
  );

  // How many times each user is already scheduled within ±SERVE_WINDOW_DAYS of
  // this set (counted once per set even if they hold several roles on it).
  // Orders the assignment dropdowns so the least-recently-scheduled surface
  // first. (Above the early return to keep hook order stable.)
  const serveCounts = useMemo<Map<string, number>>(() => {
    const counts = new Map<string, number>();
    if (!set) return counts;
    const center = new Date(set.startsAt).getTime();
    const span = SERVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    for (const s of allSets) {
      if (Math.abs(new Date(s.startsAt).getTime() - center) > span) continue;
      const seen = new Set<string>();
      for (const a of s.assignments) {
        if (seen.has(a.user.id)) continue; // one set = one serve, not per role
        seen.add(a.user.id);
        counts.set(a.user.id, (counts.get(a.user.id) ?? 0) + 1);
      }
    }
    return counts;
  }, [allSets, set?.id, set?.startsAt]);

  // Song-reorder sensors: a pointer sensor (mouse + touch) with a small
  // activation distance so focusing a row's handle doesn't start a drag, plus a
  // keyboard sensor for accessibility. Kept above the early return so hook
  // order stays stable.
  const songSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  if (!set) return null;
  // Narrowed copy of the id for closures (nested functions below don't
  // retain TS's null-check narrowing of the `set` prop itself).
  const currentSetId = set.id;

  // The set's own team shape (falls back to the global default per role).
  // This set's roles come from ITS TEAM's catalog — two teams can offer
  // entirely different ones. A team-less set falls back to the built-ins.
  const catalog = set.team?.roles?.length ? set.team.roles : DEFAULT_TEAM_ROLES;
  const rosterRoles = slottedRoles(catalog);
  // The roster above is the OWNING team's. Seats borrowed from a guest team
  // are rendered in their own blocks lower down and must not be counted here —
  // a visiting choir doesn't fill this team's own choir slots.
  const ownAssignments = set.assignments.filter((a) => !a.guestTeamId);
  const capacities = resolveTeamCapacities(catalog, set.slotCapacities);
  // What to call a role here — this team's own label, with the built-in name
  // (then a humanized key) as the fallback for a role it has since dropped.
  const labelFor = (role: string) => roleLabel(role, catalog);
  // How many people already stand in each role. The "Change Roles" editor
  // floors each count here, so shrinking the shape can never orphan someone.
  const assignedByRole = Object.fromEntries(
    rosterRoles.map((role) => [
      role.key,
      ownAssignments.filter((a) => a.role === role.key).length,
    ])
  ) as Record<BandRole, number>;

  // MD picker data. Eligible = an assignee who is an MD, plays an MD-capable
  // role (keys/electric/bass), and isn't the worship leader (see lib/md.ts).
  const mdAssignments = set.assignments.map((a) => ({
    userId: a.user.id,
    role: a.role,
    isMD: a.user.isMD,
  }));
  // MD is a catalog role now, so a team can simply not have one — and then no
  // MD surface appears on its sets at all: no picker, no "* (MD)" marker, no
  // warning, and no "Require MD" in Change Roles. A leftover requiresMD flag on
  // such a set is ignored rather than acted on.
  const supportsMD = teamSupportsMD(catalog);
  const eligibleMdIds = new Set(eligibleMDIds(mdAssignments));
  // The chosen MD, but only if still valid for the current roster (a stale id
  // — e.g. after their slot was removed — reads as "no MD").
  const mdUserId =
    supportsMD && isValidMD(set.mdUserId, mdAssignments) ? set.mdUserId : null;
  // A required-MD set is "unclosed" until one is chosen.
  const missingMD = supportsMD && set.requiresMD && !mdUserId;
  // Distinct assignees, for the MD dropdown (a person with several slots once).
  const distinctAssignees = Array.from(
    new Map(set.assignments.map((a) => [a.user.id, a.user])).values()
  );

  // This set as the scheduler sees it, for availability checks.
  const calcSet = {
    id: set.id,
    startsAt: new Date(set.startsAt),
    durationMinutes: set.durationMinutes,
  };

  const isSetWorshipLeader =
    !!currentUserId &&
    set.assignments.some(
      (a) => a.role === "WORSHIP_LEADER" && a.user.id === currentUserId
    );
  const canEditNotes = isAdmin || isSetWorshipLeader;
  const canEditTeam = isAdmin;
  // The setlist may be managed by an org admin OR anyone assigned to the set
  // (any band member can help build the setlist).
  const isSetMember =
    !!currentUserId && set.assignments.some((a) => a.user.id === currentUserId);
  const canEditSongs = isAdmin || isSetMember;

  // Options for a role's dropdown. We offer this set's team members who play
  // THIS role (per their Team-tab instruments) and aren't already filling it
  // here (a person may hold several roles on one set, so we only exclude the
  // role they already fill). Each is flagged with whether they're free at this
  // set's time, whether they're active on this team, and how many times they're
  // scheduled nearby; the list sorts available-and-active first, then
  // least-scheduled-first, so unavailable/inactive people sink to the bottom
  // (but stay selectable — an admin can override).
  // The set's worship leader(s) can't double as MD, so they never get the
  // "(MD)" hint even in an MD-capable role's dropdown.
  const worshipLeaderIds = new Set(
    set.assignments
      .filter((a) => a.role === "WORSHIP_LEADER")
      .map((a) => a.user.id)
  );
  const eligibleFor = (role: Instrument): PlayerOption[] => {
    // In an MD-capable role, mark the musical directors — picking them here
    // makes them an eligible MD for the set.
    const roleAllowsMD = (MD_ROLES as Instrument[]).includes(role);
    return buildPlayerOptions({
      users,
      role,
      teamId: set.teamId ?? set.team?.id,
      set: calcSet,
      rules,
      // Whoever already fills this exact role here (a person may hold several
      // roles on one set, so only this role's occupants are excluded).
      exclude: new Set(
        ownAssignments.filter((a) => a.role === role).map((a) => a.user.id)
      ),
      serveCounts,
      isMDHere: (u) =>
        roleAllowsMD &&
        !!users.find((x) => x.id === u.id)?.isMD &&
        !worshipLeaderIds.has(u.id),
    });
  };

  // Options for ONE borrowed seat. Same availability/load logic as the roster
  // above, but drawn from the GUEST team's members rather than this set's own —
  // that's the whole point of a guest team.
  //
  // Anyone already on the set in any seat is excluded, not just sunk: a person
  // playing keys for the host team can't also stand in the visiting choir, and
  // offering them would only invite a double-booking. (Contrast the roster's
  // own dropdowns, where an unavailable person stays pickable so an admin can
  // deliberately override.)
  const guestOptionsFor = (
    guest: ApiSetGuestTeam,
    role: Instrument
  ): PlayerOption[] =>
    buildPlayerOptions({
      users,
      role,
      teamId: guest.teamId,
      set: calcSet,
      rules,
      exclude: new Set(set.assignments.map((a) => a.user.id)),
      serveCounts,
    });

  async function runEdit(fn: () => Promise<Response>) {
    setBusy(true);
    try {
      await fn();
      await onChanged?.();
      refetchHistory(currentSetId);
    } finally {
      setBusy(false);
    }
  }

  const reassign = (assignmentId: string, userId: string) =>
    runEdit(() =>
      fetch(`/api/admin/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })
    );

  const removeAssignment = (assignmentId: string) =>
    runEdit(() =>
      fetch(`/api/admin/assignments/${assignmentId}`, { method: "DELETE" })
    );

  // `guestTeamId` marks the new seat as borrowed from that guest row; omitting
  // it (the roster's own dropdowns) creates an ordinary owning-team seat.
  const addAssignment = (
    role: Instrument,
    userId: string,
    guestTeamId?: string
  ) =>
    runEdit(() =>
      fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setId: set.id, userId, role, guestTeamId }),
      })
    );

  // Fill the empty slots server-side, keeping everyone already assigned in
  // place (their slots are constraints the fill works around). Never removes or
  // moves anyone, so there's nothing to confirm.
  //
  // Scoped to ONE roster: omit `guestTeamId` for the set's own team, or pass a
  // guest row's id to fill just that other team's borrowed seats. Each has its
  // own button, and neither touches the other's people.
  const autoSchedule = async (guestTeamId?: string) => {
    setAutofilling(guestTeamId ?? "own");
    try {
      await runEdit(() =>
        fetch(`/api/admin/sets/${currentSetId}/autofill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guestTeamId }),
        })
      );
    } finally {
      setAutofilling(null);
    }
  };

  // Remove ONE slot of a role from this set (capacity − 1). For a filled slot
  // pass its assignmentId — the person is unassigned in the same request.
  const deleteSlot = (role: Instrument, assignmentId?: string) => {
    setSlotToDelete(null);
    const query = assignmentId ? `?assignmentId=${assignmentId}` : "";
    return runEdit(() =>
      fetch(`/api/admin/sets/${currentSetId}/roles/${role}${query}`, {
        method: "DELETE",
      })
    );
  };

  const saveNotes = () =>
    runEdit(() =>
      fetch(`/api/sets/${set.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesDraft }),
      })
    );

  // Drag-and-drop reorder (dnd-kit): apply the move on drop. The debounced
  // auto-save persists the new order. (Sensors are set up with the hooks above.)
  const handleSongDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSongDraft((rows) => {
      const from = rows.findIndex((r) => r.id === active.id);
      const to = rows.findIndex((r) => r.id === over.id);
      if (from < 0 || to < 0) return rows;
      return arrayMove(rows, from, to);
    });
  };

  // Flip this set's private flag (admin only). Private = hidden from everyone
  // except org admins and the people assigned to it.
  const togglePrivate = (isPrivate: boolean) =>
    runEdit(() =>
      fetch(`/api/sets/${currentSetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrivate }),
      })
    );

  // Save the "Change Roles" draft. The PATCH route takes one field per call, so
  // this fires up to three — but only for what actually changed, and in one
  // runEdit so the modal refetches (and the history reloads) exactly once.
  const saveRoles = async () => {
    const draft = rolesDraft;
    if (!draft || !set) return;
    const patches: Record<string, unknown>[] = [];
    if (JSON.stringify(draft.capacities) !== JSON.stringify(capacities)) {
      // A shape that matches the default is stored as null (no override), so
      // the set keeps tracking the default if it ever changes.
      const isDefault =
        JSON.stringify(draft.capacities) ===
        JSON.stringify(resolveTeamCapacities(catalog, null));
      patches.push({ slotCapacities: isDefault ? null : draft.capacities });
    }
    if (draft.requiresMD !== set.requiresMD) {
      patches.push({ requiresMD: draft.requiresMD });
    }
    setRolesDraft(null);
    if (patches.length === 0) return;
    await runEdit(async () => {
      let last: Response | undefined;
      for (const body of patches) {
        last = await fetch(`/api/sets/${currentSetId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      return last!;
    });
  };

  // The current guest config as the editor's draft shape.
  const guestDraftFromSet = (): GuestTeamDraft[] =>
    (set.guestTeams ?? []).map((g) => ({ teamId: g.teamId, roles: g.roles }));

  // How many people already sit in one borrowed seat — the editor floors each
  // count here so shrinking a guest role can't orphan someone.
  const seatedInGuestRole = (teamId: string, role: string) => {
    const guest = (set.guestTeams ?? []).find((g) => g.teamId === teamId);
    if (!guest) return 0;
    return set.assignments.filter(
      (a) => a.guestTeamId === guest.id && a.role === role
    ).length;
  };

  // Save the whole guest list in one PATCH (the server diffs it against what
  // the set already has, so seats people are standing in keep their ids).
  const saveGuestTeams = async (next: GuestTeamDraft[]) => {
    setGuestDraft(null);
    if (JSON.stringify(next) === JSON.stringify(guestDraftFromSet())) return;
    await runEdit(() =>
      fetch(`/api/sets/${currentSetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestTeams: next }),
      })
    );
  };

  // Set (or clear, with "") this set's designated MD.
  const setMD = (userId: string) =>
    runEdit(() =>
      fetch(`/api/sets/${currentSetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mdUserId: userId || null }),
      })
    );

  // Open a Slack group DM among this set's assigned team and post an intro.
  const messageTeamOnSlack = async () => {
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch(`/api/sets/${set.id}/slack-group`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({
          text: data.error ?? "Could not message the team.",
          tone: "error",
        });
        return;
      }
      // One toast per click, plus the tick on the button itself. The caveat —
      // the chat went out but its Spotify playlist didn't — rides along in the
      // same message rather than as a second piece of feedback.
      setToast(
        data.playlistNote
          ? {
              text: `Team messaged on Slack. No Spotify playlist: ${data.playlistNote}`,
              tone: "info",
            }
          : { text: "Team messaged on Slack.", tone: "success" }
      );
      setSlackDone(true);
      if (slackDoneTimer.current) clearTimeout(slackDoneTimer.current);
      slackDoneTimer.current = setTimeout(() => setSlackDone(false), 2500);
    } finally {
      setBusy(false);
    }
  };

  // Set (or turn off, with null) when this set's private Slack channel is auto-
  // created ahead of time (admin only). The daily cron makes it once inside the
  // window; the manual "Slack Team" button still works regardless.
  const setGroupChatLead = (value: number | null) =>
    runEdit(() =>
      fetch(`/api/sets/${currentSetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupChatLeadDays: value }),
      })
    );

  // Delete the whole set (assignments cascade). Closes the modal afterwards.
  const deleteSet = async () => {
    setBusy(true);
    try {
      await fetch(`/api/sets/${set.id}`, { method: "DELETE" });
      await onChanged?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    // While the slot-delete confirm is stacked on top, Escape/overlay on the
    // outer modal only dismiss the confirm (both modals listen for Escape).
    <Modal
      open
      size="xl"
      onClose={slotToDelete ? () => setSlotToDelete(null) : onClose}
      title={set.label ?? "Worship Set"}
      titleAccessory={
        /* On the title line: the set's org (matters in "All orgs" views), its
           team, and — for a private set — a bare lock icon. Sits right of the
           title rather than down on the date line. */
        (set.org || set.team || set.isPrivate) && (
          <span className="flex items-center gap-2">
            {set.org && (
              <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                {set.org.name}
              </span>
            )}
            {set.team && (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {set.team.name}
              </span>
            )}
            {/* Private = only admins + assigned people ever see this modal. */}
            {set.isPrivate && (
              <span
                title="Private"
                aria-label="Private"
                className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs leading-none text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              >
                🔒
              </span>
            )}
          </span>
        )
      }
      subtitle={
        <>
          {formatDay(set.startsAt)} · {formatTime(set.startsAt)}
        </>
      }
    >
      {/* Action bar right below the title: Auto schedule on the left; Slack +
          the overflow (⋮) menu on the right. The (i) tooltip opens DOWNWARD so
          it isn't clipped by the top of the modal. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-3 dark:border-gray-700">
        <div className="flex items-center gap-1.5">
          {canEditTeam && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => autoSchedule()}
                disabled={busy}
              >
                {autofilling === "own" ? (
                  <LoadingDots size="sm" />
                ) : (
                  "Auto schedule"
                )}
              </Button>
              <InfoTooltip
                side="bottom"
                text={
                  <>
                    Fills this set&apos;s <strong>empty slots</strong>{" "}
                    with available team members, preferring people who aren&apos;t
                    already serving in the surrounding week. People already
                    assigned keep their roles — the fill works around them.
                    Seats borrowed from other teams have their own Auto schedule
                    button, on their block below. In
                    the assignment dropdowns, the ×N badge is how many times
                    that person is already scheduled within ±2 weeks of this
                    set; the least-scheduled, available people are listed first.
                  </>
                }
              />
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Shown to everyone (any team member can start the group chat), but
              disabled until this org connects Slack — the affordance stays
              discoverable and the tooltip explains what's missing. */}
          <Button
            size="sm"
            variant="secondary"
            onClick={messageTeamOnSlack}
            disabled={busy || !slackConfigured}
            title={
              slackConfigured
                ? undefined
                : "Connect Slack for this organization to message the team."
            }
          >
            <span className="flex items-center gap-1.5">
              {slackDone ? (
                <>
                  <svg
                    aria-hidden
                    viewBox="0 0 20 20"
                    className="h-4 w-4 text-green-600 dark:text-green-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 10.5l4 4 8-9" />
                  </svg>
                  Sent
                </>
              ) : (
                <>
                  <SlackIcon />
                  Slack Team
                </>
              )}
            </span>
          </Button>

          {/* Overflow menu: the less-common set actions. Admin-only toggles
              (Require MD / Choir / Private) plus the .ics export, which stays
              available to everyone (so the menu always has at least that item). */}
          <Dropdown
            align="right"
            hover
            // Wide enough for "Auto GC 1 week before ›" to stay on one line,
            // and overflow-visible so that row's submenu can escape the panel.
            widthClassName="w-56"
            menuClassName="overflow-visible"
            trigger={(menuOpen) => (
              <span
                aria-label="More actions"
                title="More actions"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-600 transition-colors hover:bg-gray-50 hover:text-indigo-600 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-indigo-400"
              >
                {/* Three horizontal lines that morph into an "✕" when the menu
                    is open (top/bottom rotate to cross, middle fades out). */}
                <span aria-hidden className="relative block h-4 w-3.5">
                  <span
                    className={`absolute left-0 h-0.5 w-3.5 rounded bg-current transition-all duration-200 ${
                      menuOpen
                        ? "top-1/2 -translate-y-1/2 rotate-45"
                        : "top-[3px]"
                    }`}
                  />
                  <span
                    className={`absolute left-0 top-1/2 h-0.5 w-3.5 -translate-y-1/2 rounded bg-current transition-all duration-200 ${
                      menuOpen ? "opacity-0" : "opacity-100"
                    }`}
                  />
                  <span
                    className={`absolute left-0 h-0.5 w-3.5 rounded bg-current transition-all duration-200 ${
                      menuOpen
                        ? "bottom-1/2 translate-y-1/2 -rotate-45"
                        : "bottom-[3px]"
                    }`}
                  />
                </span>
              </span>
            )}
          >
            {canEditTeam && (
              <>
                {/* The team shape lives in its own modal — a role-by-role
                    editor is far too much for a menu row, and the Require-MD
                    flag belongs with it since it's the other thing that
                    decides who a set has room for. Borrowing another team's
                    people is its own modal (below) — it's about WHO may sit
                    here, not how many seats this team wants. */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setRolesDraft({
                      capacities,
                      requiresMD: set.requiresMD,
                    })
                  }
                  className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-sm
                    text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50
                    dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  <span aria-hidden className="w-4" />
                  Change Roles
                </button>
                {/* Other teams: borrow another team's people for this set only
                    (the choir team joining a Sunday set). Separate from Change
                    Roles because it edits a different question — not "how many
                    seats does this team want" but "who else may fill seats
                    here". */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setGuestDraft(guestDraftFromSet())}
                  className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-sm
                    text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50
                    dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  <span aria-hidden className="w-4" />
                  Other teams
                  {(set.guestTeams ?? []).length > 0 && (
                    <span className="ml-auto rounded-full bg-purple-100 px-1.5 text-xs font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                      {(set.guestTeams ?? []).length}
                    </span>
                  )}
                </button>
                <MenuToggle
                  label="Private"
                  on={set.isPrivate}
                  disabled={busy}
                  onClick={() => togglePrivate(!set.isPrivate)}
                />
              </>
            )}
            {/* Admin-only: when to auto-create this set's private Slack group
                chat ("Auto GC"). The daily cron makes it once inside the
                window; "Slack Team" still creates it on demand. Only
                meaningful once the org has Slack. */}
            {canEditTeam && slackConfigured && (
              <GroupChatLeadMenu
                value={set.groupChatLeadDays ?? null}
                disabled={busy}
                onSelect={setGroupChatLead}
              />
            )}
            <a
              href={`/api/export/${set.id}`}
              download
              title="Export set (.ics)"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <span aria-hidden className="w-4" />
              Export (.ics)
            </a>
          </Dropdown>
        </div>
      </div>
      {/* Slack result. Portals itself to the bottom of the screen and clears
          after a few seconds, so it floats over the modal instead of pushing
          this content around. */}
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Amber warning while a required-MD set still has no musical director;
          nothing once an MD is on the team (the * MD marker says enough). */}
      {missingMD && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          ⚠ This set requires an MD but none is assigned yet.
        </p>
      )}

      <ul className="space-y-3">
        {rosterRoles.map(({ key: role }) => {
          const filled = ownAssignments.filter((a) => a.role === role);
          const capacity = capacities[role];
          const openSlots = Math.max(0, capacity - filled.length);
          const options = eligibleFor(role);

          // Roles this set doesn't want (capacity 0) and has nobody in are
          // hidden entirely — no point showing an empty "0/0" row.
          if (capacity === 0 && filled.length === 0) return null;

          return (
            <li key={role} className="text-sm">
              <span className="font-medium">
                {labelFor(role)}
                {capacity > 1 && (
                  <span className="ml-1 text-xs text-gray-500">
                    ({filled.length}/{capacity})
                  </span>
                )}
              </span>

              <ul className="mt-1 space-y-1 pl-4">
                {filled.map((a) =>
                  canEditTeam ? (
                    // Selecting "None" removes the person; picking another
                    // reassigns (which resets the slot to PENDING). The "✕"
                    // deletes this whole slot — confirmed first, since the
                    // person goes with it.
                    <li key={a.id} className="flex items-center gap-2">
                      <SlotDeleteButton
                        label={`Remove ${labelFor(role)} slot (${a.user.name})`}
                        disabled={busy}
                        onClick={() => setSlotToDelete(a)}
                      />
                      <PlayerSelect
                        selected={{ id: a.user.id, name: a.user.name }}
                        options={options}
                        disabled={busy}
                        onChange={(userId) =>
                          userId
                            ? reassign(a.id, userId)
                            : removeAssignment(a.id)
                        }
                      />
                      {a.user.id === mdUserId && (
                        <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                          * (MD)
                        </span>
                      )}
                      <StatusBadge status={a.status} />
                    </li>
                  ) : (
                    // Read-only view: the name sits in a box that mirrors
                    // PlayerSelect's trigger (same w-48, border, padding and
                    // radius) so admin and non-admin rosters line up visually.
                    // No chevron and no button element — it isn't interactive,
                    // and a chevron would advertise a menu that doesn't exist.
                    <li key={a.id} className="flex items-center gap-2">
                      <div className="flex w-48 items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800">
                        <span className="truncate">{a.user.name}</span>
                        {a.user.id === mdUserId && (
                          <span className="shrink-0 font-medium text-indigo-600 dark:text-indigo-400">
                            * (MD)
                          </span>
                        )}
                      </div>
                      <StatusBadge status={a.status} />
                    </li>
                  )
                )}

                {/* Empty slots: a dash (read) or a "None"-default dropdown that
                    assigns someone when picked (admin). */}
                {Array.from({ length: openSlots }).map((_, i) =>
                  canEditTeam ? (
                    // Empty slot: its "✕" removes the slot right away (nobody
                    // is affected, so no confirm step).
                    <li key={`add-${i}`} className="flex items-center gap-2">
                      <SlotDeleteButton
                        label={`Remove empty ${labelFor(role)} slot`}
                        disabled={busy}
                        onClick={() => deleteSlot(role)}
                      />
                      <PlayerSelect
                        selected={null}
                        options={options}
                        disabled={busy}
                        dashed
                        onChange={(userId) =>
                          userId && addAssignment(role, userId)
                        }
                      />
                    </li>
                  ) : (
                    // Matching dashed box for an unfilled slot, so a read-only
                    // roster is a clean column of boxes rather than boxes
                    // interrupted by bare dashes. Mirrors PlayerSelect's
                    // `dashed` empty state.
                    <li key={`empty-${i}`}>
                      <div className="w-48 rounded border border-dashed border-gray-300 px-2 py-1 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
                        Unfilled
                      </div>
                    </li>
                  )
                )}
              </ul>
            </li>
          );
        })}
      </ul>

      {/* Other teams: teams lending people to this set (e.g. the choir
          team joining a Sunday-team set). Each borrowed team gets its own
          block, because a role key only means something within its team's
          catalog — a guest "Choir" and this team's own "Choir" are different
          seats, told apart by the assignment's guestTeamId.

          A role with a count renders fixed slots like the roster above; one
          marked "as many as available" renders whoever is on it plus a single
          spare add row, since there's no target to derive empty slots from.
          That unbounded seat is what the hardcoded choir section used to be. */}
      {(set.guestTeams ?? []).map((guest) => {
        const guestCatalog = guest.team.roles?.length
          ? guest.team.roles
          : DEFAULT_TEAM_ROLES;
        // Only show a guest block that has something to show: any seat, or an
        // admin who can add one.
        const seats = guest.roles.filter(
          (spec) =>
            canEditTeam ||
            set.assignments.some(
              (a) => a.guestTeamId === guest.id && a.role === spec.role
            )
        );
        if (seats.length === 0) return null;

        return (
          <div
            key={guest.id}
            data-testid={`guest-team-${guest.teamId}`}
            className="mt-4 border-t border-gray-200 pt-4 text-sm dark:border-gray-700"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="flex items-center gap-1.5 font-medium">
                {guest.team.name}
                {canEditTeam && (
                  <InfoTooltip text="People borrowed from another team for this set only. Manage which teams and roles under Other teams in the (⋮) menu." />
                )}
              </span>
              {/* This block's own fill, deliberately separate from the action
                  bar's: it seats only the borrowed roles above, and the main
                  button leaves them alone. Same non-destructive rule — it fills
                  empty seats and never moves anyone already here. */}
              {canEditTeam && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => autoSchedule(guest.id)}
                  disabled={busy}
                  title={`Fill ${guest.team.name}'s empty seats on this set — the rest of the roster is left alone`}
                >
                  {autofilling === guest.id ? (
                    <LoadingDots size="sm" />
                  ) : (
                    "Auto schedule"
                  )}
                </Button>
              )}
            </div>

            <ul className="mt-1 space-y-3 pl-1">
              {seats.map((spec) => {
                const filled = set.assignments.filter(
                  (a) => a.guestTeamId === guest.id && a.role === spec.role
                );
                const unbounded = isUnbounded(spec);
                // Unbounded seats show one spare row to add into; counted ones
                // show exactly the slots still open.
                const openRows = unbounded
                  ? canEditTeam
                    ? 1
                    : 0
                  : openSeats(spec, filled.length);
                const options = guestOptionsFor(guest, spec.role);

                return (
                  <li key={spec.role}>
                    <span className="font-medium">
                      {roleLabel(spec.role, guestCatalog)}
                      <span className="ml-1 text-xs text-gray-500">
                        {unbounded
                          ? `(${filled.length} · as many as available)`
                          : spec.count > 1
                            ? `(${filled.length}/${spec.count})`
                            : ""}
                      </span>
                    </span>

                    <ul className="mt-1 space-y-1 pl-4">
                      {filled.map((a) =>
                        canEditTeam ? (
                          <li key={a.id} className="flex items-center gap-2">
                            <SlotDeleteButton
                              label={`Remove ${a.user.name} from ${guest.team.name}`}
                              disabled={busy}
                              onClick={() => removeAssignment(a.id)}
                            />
                            <PlayerSelect
                              selected={{ id: a.user.id, name: a.user.name }}
                              options={options}
                              disabled={busy}
                              onChange={(userId) =>
                                userId
                                  ? reassign(a.id, userId)
                                  : removeAssignment(a.id)
                              }
                            />
                            <StatusBadge status={a.status} />
                          </li>
                        ) : (
                          <li key={a.id} className="flex items-center gap-2">
                            <div className="w-48 rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800">
                              <span className="truncate">{a.user.name}</span>
                            </div>
                            <StatusBadge status={a.status} />
                          </li>
                        )
                      )}

                      {/* Open seats. The add row has no "✕" (there's nothing to
                          remove yet), so an invisible spacer keeps its dropdown
                          in line with the filled rows above. */}
                      {canEditTeam &&
                        Array.from({ length: openRows }).map((_, i) => (
                          <li
                            key={`guest-add-${i}`}
                            className="flex items-center gap-2"
                          >
                            <span
                              aria-hidden
                              className="invisible rounded p-0.5 text-xs leading-none"
                            >
                              ✕
                            </span>
                            <PlayerSelect
                              selected={null}
                              options={options}
                              disabled={busy}
                              dashed
                              onChange={(userId) =>
                                userId &&
                                addAssignment(spec.role, userId, guest.id)
                              }
                            />
                          </li>
                        ))}
                      {!canEditTeam &&
                        Array.from({ length: openRows }).map((_, i) => (
                          <li key={`guest-empty-${i}`}>
                            <div className="w-48 rounded border border-dashed border-gray-300 px-2 py-1 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
                              Unfilled
                            </div>
                          </li>
                        ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {/* MD picker (only for sets that require one). One MD per set, chosen from
          the assignees — clickable only for those who qualify (an MD playing
          keys/electric/bass, never the worship leader). */}
      {supportsMD && set.requiresMD && (
        <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
          {canEditTeam ? (
            <div className="space-y-1.5">
              {/* The eligibility rule (who can be MD) lives in the header's (i)
                  tooltip rather than as inline body text. */}
              <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                Musical director
                <InfoTooltip text="The MD must be a musical director who plays keys, electric guitar, or bass — and never the worship leader." />
              </span>
              {eligibleMdIds.size === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  None of the people assigned to this set can be MD yet.
                </p>
              ) : (
                <PlayerSelect
                  selected={
                    mdUserId
                      ? {
                          id: mdUserId,
                          name:
                            distinctAssignees.find((u) => u.id === mdUserId)
                              ?.name ?? "",
                        }
                      : null
                  }
                  // Only eligible assignees are offered (ineligible people can't
                  // be MD; the zero-eligible case is handled by the message above).
                  options={distinctAssignees
                    .filter((u) => eligibleMdIds.has(u.id) && u.id !== mdUserId)
                    .map((u) => ({ id: u.id, name: u.name, available: true }))}
                  disabled={busy}
                  onChange={(userId) => setMD(userId)}
                />
              )}
            </div>
          ) : (
            <p className="text-sm">
              <span className="font-medium">Musical director:</span>{" "}
              {mdUserId
                ? distinctAssignees.find((u) => u.id === mdUserId)?.name ??
                  "—"
                : "none yet"}
            </p>
          )}
        </div>
      )}

      {/* Songs: the worship leader's setlist (title + key). Editable by admins
          and anyone assigned to the set; everyone else sees it read-only. Feeds
          the collaborative Spotify playlist auto-created with the group chat. */}
      <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Songs
        </p>
        {canEditSongs ? (
          <div className="space-y-2">
            {/* Drag a row by its handle to reorder; the numbered badge shows its
                position. Only the handle carries the drag listeners, so the
                inputs stay fully editable and touch drag works (dnd-kit pointer
                sensor). Changes auto-save (debounced) — there's no save button. */}
            <DndContext
              sensors={songSensors}
              collisionDetection={closestCenter}
              onDragEnd={handleSongDragEnd}
            >
              <SortableContext
                items={songDraft.map((r) => r.id)}
                strategy={verticalListSortingStrategy}
              >
                {songDraft.map((row, i) => (
                  <SortableSongRow
                    key={row.id}
                    row={row}
                    position={i + 1}
                    onTitle={(v) =>
                      setSongDraft((rows) =>
                        rows.map((r) => (r.id === row.id ? { ...r, title: v } : r))
                      )
                    }
                    onKey={(v) =>
                      setSongDraft((rows) =>
                        rows.map((r) => (r.id === row.id ? { ...r, key: v } : r))
                      )
                    }
                    onRemove={() =>
                      setSongDraft((rows) => rows.filter((r) => r.id !== row.id))
                    }
                  />
                ))}
              </SortableContext>
            </DndContext>
            {/* Capped at what the server accepts. Past the cap the PUT 400s,
                which — with an auto-save that retries whenever draft and saved
                disagree — would mean re-POSTing a doomed list forever. */}
            <Button
              size="sm"
              variant="secondary"
              disabled={songDraft.length >= MAX_SONGS_PER_SET}
              onClick={() =>
                setSongDraft((rows) => [
                  ...rows,
                  { id: crypto.randomUUID(), title: "", key: "" },
                ])
              }
            >
              + Add song
            </Button>
          </div>
        ) : (set.songs ?? []).length > 0 ? (
          <ol className="list-decimal space-y-0.5 pl-5 text-sm text-gray-700 dark:text-gray-300">
            {(set.songs ?? []).map((s) => (
              <li key={s.id}>
                {s.title}
                {s.key && (
                  <span className="ml-1 text-gray-400">({s.key})</span>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-gray-400">No songs yet.</p>
        )}

        {/* Spotify: the collaborative playlist is created automatically when the
            set's group chat is made (see lib/slack.ts), so there's no manual
            button — just a link to open it once it exists. */}
        {set.spotifyPlaylistUrl && (
          <div className="mt-3">
            <a
              href={set.spotifyPlaylistUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-green-600 hover:underline dark:text-green-400"
            >
              Open Spotify playlist ↗
            </a>
          </div>
        )}
      </div>

      {/* Notes (bottom): editable by admins + the worship leader. */}
      <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Notes
        </p>
        {canEditNotes ? (
          <div className="space-y-2">
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={2}
              placeholder="e.g. Communion Sunday — extra song at the end"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
                dark:border-gray-600 dark:bg-gray-800"
            />
            {notesDraft !== (set.notes ?? "") && (
              <Button size="sm" onClick={saveNotes} disabled={busy}>
                Save notes
              </Button>
            )}
          </div>
        ) : set.notes ? (
          <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
            {set.notes}
          </p>
        ) : (
          <p className="text-sm text-gray-400">No notes.</p>
        )}
      </div>

      {/* History: a chronological log of who confirmed, who was manually
          swapped/added/removed (and by which admin), and swap requests. */}
      <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          History
        </p>
        {/* "Loading…" only on a FIRST load. A refresh (after any edit here)
            keeps the existing rows on screen and swaps them in place — blanking
            a 12rem list down to one line and back moved everything under it and
            yanked the modal's scroll position out from under the reader. */}
        {historyLoading && history.length === 0 ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-gray-400">No activity yet.</p>
        ) : (
          <ul className="max-h-48 divide-y divide-gray-200 overflow-y-auto dark:divide-gray-700">
            {history.map((event) => (
              <SetHistoryEntry key={event.id} event={event} />
            ))}
          </ul>
        )}
      </div>

      {/* Danger zone: admins can delete the whole set (two-step confirm). */}
      {isAdmin && (
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
          {confirmingDelete ? (
            <>
              <span className="mr-auto text-sm text-gray-600 dark:text-gray-400">
                Delete this set and its whole team?
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={deleteSet}
                disabled={busy}
              >
                Confirm delete
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="danger"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
            >
              Delete set
            </Button>
          )}
        </div>
      )}

      {/* Stacked "Change Roles": this set's team shape, plus the Require-MD
          flag. Each role's count floors at the people already standing in it,
          so an edit here can never quietly drop someone from the set. */}
      {rolesDraft && (
        <Modal
          open
          onClose={() => setRolesDraft(null)}
          title="Change roles"
          subtitle="How many of each role this set wants"
          footer={
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setRolesDraft(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={saveRoles} disabled={busy}>
                {busy ? <LoadingDots size="sm" /> : "Save"}
              </Button>
            </>
          }
        >
          <SlotCapacityEditor
            catalog={catalog}
            value={rolesDraft.capacities}
            mins={assignedByRole}
            disabled={busy}
            onChange={(next) =>
              setRolesDraft((d) => (d ? { ...d, capacities: next } : d))
            }
          />

          <div className="mt-4 space-y-2 border-t border-gray-200 pt-4 dark:border-gray-700">
            {/* Only where the team's catalog still has MD — delete the role
                and the whole notion goes with it. */}
            {supportsMD && (
              <Checkbox
                label="Require MD"
                checked={rolesDraft.requiresMD}
                disabled={busy}
                onChange={(e) =>
                  setRolesDraft((d) =>
                    d ? { ...d, requiresMD: e.target.checked } : d
                  )
                }
              />
            )}
          </div>

          {/* Back to the org's default shape — only offered while this set
              actually carries an override. */}
          {set.slotCapacities && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setRolesDraft((d) =>
                  d
                    ? { ...d, capacities: resolveTeamCapacities(catalog, null) }
                    : d
                )
              }
              className="mt-4 text-sm font-medium text-indigo-600 hover:underline disabled:opacity-60 dark:text-indigo-400"
            >
              Reset to the default team shape
            </button>
          )}
        </Modal>
      )}

      {/* Stacked "Other teams" editor. Teams offered exclude the set's own —
          a set can't borrow from itself. */}
      {guestDraft && (
        <GuestTeamsModal
          open
          onClose={() => setGuestDraft(null)}
          teams={(orgTeams ?? []).filter((t) => t.id !== (set.teamId ?? set.team?.id))}
          value={guestDraft}
          seatedCount={seatedInGuestRole}
          onSave={saveGuestTeams}
          busy={busy}
        />
      )}

      {/* Stacked confirm for removing a slot that still has a person in it. */}
      {slotToDelete && (
        <Modal
          open
          onClose={() => setSlotToDelete(null)}
          title={`Remove ${labelFor(slotToDelete.role)} slot?`}
        >
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {slotToDelete.user.name} is assigned to this{" "}
            {labelFor(slotToDelete.role)} slot. Removing the slot also
            removes them from this set.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setSlotToDelete(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => deleteSlot(slotToDelete.role, slotToDelete.id)}
              disabled={busy}
            >
              Remove slot
            </Button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

// A toggle row inside the overflow (⋮) menu. A leading check marks the "on"
// state; it's aria-hidden so the button's accessible name is just `label`.
function MenuToggle({
  label,
  on,
  disabled,
  title,
  onClick,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={on}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700
        hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50
        dark:text-gray-200 dark:hover:bg-gray-700"
    >
      <span
        aria-hidden
        className="w-4 text-center text-indigo-600 dark:text-indigo-400"
      >
        {on ? "✓" : ""}
      </span>
      {label}
    </button>
  );
}

// The "Auto GC …" row inside the overflow (⋮) menu: shows the set's current
// group-chat lead time on one line and flies out a list of choices on hover.
// The flyout opens to the RIGHT, matching the direction the row's chevron
// points.
function GroupChatLeadMenu({
  value,
  disabled,
  onSelect,
}: {
  value: number | null;
  disabled: boolean;
  onSelect: (days: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // Like the menus it lives inside: hover reveals the flyout, but a click
  // LATCHES it open so the pointer can leave the row without it snapping shut.
  const latched = useRef(false);

  // "No Auto GC" when off, otherwise "Auto GC " + the matching option label
  // ("3 days before" / "1 week before"). A lead time set outside this menu
  // (e.g. from a template) still reads correctly via the fallback.
  const selected = GROUP_CHAT_LEAD_OPTIONS.find((o) => o.days === value);
  let rowLabel = "No Auto GC";
  if (value != null) {
    rowLabel = `Auto GC ${selected?.label ?? `${value} days before`}`;
  }

  return (
    <div
      className="relative border-t border-gray-200 dark:border-gray-700"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!latched.current) setOpen(false);
      }}
    >
      <button
        type="button"
        disabled={disabled}
        // A tap/click latches the flyout open (and the next one closes it) —
        // which is also what makes this work on touch, where there's no hover.
        // The stopPropagation keeps that tap from closing the whole (⋮) menu,
        // which closes on any click inside it.
        onClick={(e) => {
          e.stopPropagation();
          latched.current = !latched.current;
          setOpen(latched.current);
        }}
        className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-sm
          text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50
          dark:text-gray-200 dark:hover:bg-gray-700"
      >
        <span aria-hidden className="w-4" />
        <span className="flex-1">{rowLabel}</span>
        <span aria-hidden className="text-gray-400">
          ›
        </span>
      </button>

      {open && (
        // Phones: drop the list below the row — there's no room to fly out
        // beside an already right-pinned menu on a narrow screen. Wider
        // screens: fly out to the right, the way the row's `›` points, where
        // `pl-1` keeps the gap between row and flyout hoverable so the pointer
        // can cross it without the flyout closing.
        <div className="absolute right-0 top-full z-50 pt-1 sm:left-full sm:right-auto sm:top-0 sm:pl-1 sm:pt-0">
          <div className="w-40 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            {GROUP_CHAT_LEAD_OPTIONS.map((option) => (
              <button
                key={option.label}
                type="button"
                disabled={disabled}
                // No stopPropagation here: letting the click bubble closes the
                // (⋮) menu, which is what you want after picking.
                onClick={() => {
                  if (option.days !== value) onSelect(option.days);
                }}
                className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-sm
                  text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50
                  dark:text-gray-200 dark:hover:bg-gray-700"
              >
                <span
                  aria-hidden
                  className="w-3 text-center text-indigo-600 dark:text-indigo-400"
                >
                  {option.days === value ? "✓" : ""}
                </span>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// The small "✕" to the left of each slot row (admin only): deletes that one
// slot of the role from this set.
function SlotDeleteButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded p-0.5 text-xs leading-none text-gray-400
        hover:bg-red-50 hover:text-red-600 disabled:opacity-50
        dark:hover:bg-red-900/30 dark:hover:text-red-400"
    >
      ✕
    </button>
  );
}

// One editable, draggable song row. The drag listeners live only on the grip
// handle so the title/key inputs stay fully usable; dnd-kit's transform/
// transition animate it while sorting.
function SortableSongRow({
  row,
  position,
  onTitle,
  onKey,
  onRemove,
}: {
  row: { id: string; title: string; key: string };
  position: number;
  onTitle: (value: string) => void;
  onKey: (value: string) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Lift the row above its siblings while it's being dragged.
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.6 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      {/* Drag handle (grip + 1-based position). `touch-none` lets the pointer
          sensor own touch gestures instead of the browser scrolling. */}
      <span
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="flex shrink-0 cursor-grab touch-none items-center gap-1 text-gray-400 focus:outline-none active:cursor-grabbing"
      >
        <GripIcon />
        <span className="w-4 text-right text-sm font-medium tabular-nums text-gray-500 dark:text-gray-400">
          {position}
        </span>
      </span>
      <input
        value={row.title}
        onChange={(e) => onTitle(e.target.value)}
        placeholder="Song title"
        className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm
          focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
          dark:border-gray-600 dark:bg-gray-800"
      />
      <select
        value={row.key}
        onChange={(e) => onKey(e.target.value)}
        aria-label="Key"
        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm
          focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
          dark:border-gray-600 dark:bg-gray-800"
      >
        <option value="">Key</option>
        {SONG_KEYS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove song"
        className="px-1 text-gray-400 hover:text-red-600"
      >
        ✕
      </button>
    </div>
  );
}

// Six-dot grab handle shown at the left of each editable song row.
function GripIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <circle cx="7" cy="5" r="1.5" />
      <circle cx="13" cy="5" r="1.5" />
      <circle cx="7" cy="10" r="1.5" />
      <circle cx="13" cy="10" r="1.5" />
      <circle cx="7" cy="15" r="1.5" />
      <circle cx="13" cy="15" r="1.5" />
    </svg>
  );
}
