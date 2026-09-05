"use client";
// Edit personal info: name, email, teams, and a Slack member ID field for the
// future Slack integration. The Teams & roles panel is a READ-ONLY list for
// everyone: which teams you're on AND the roles you play on them are an org
// admin's call, set from the Team tab, so the panel lists them with a note
// pointing at your admin. NOBODY adds themselves to a team from here, admins
// included — an admin who wants to be on a team puts themselves there from the
// Team tab like anyone else, so the roster always has one owner. The only write
// left is "Leave this team", and an admin of that team's org gets it (the API
// enforces the same rule, so hiding the control isn't the whole guard).
// Password changes happen in a separate modal that requires typing the new
// password twice.
import { useSession } from "next-auth/react";
import { FormEvent, useEffect, useRef, useState } from "react";
import Badge from "@/components/common/Badge";
import Banner from "@/components/common/Banner";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Checkbox from "@/components/common/Checkbox";
import InfoTooltip from "@/components/common/InfoTooltip";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import { PROFILE_CHANGED_EVENT } from "@/components/Navbar";
import { DEFAULT_TEAM_ROLES, orderedRoles } from "@/lib/teamRoles";
import type { ApiTeamRole } from "@/lib/types";

type Membership = {
  orgId: string;
  orgName: string;
  // Am I an admin of THIS org? Gates the join/leave controls below — team
  // membership is an admin's to change, per org.
  isAdmin: boolean;
  slackUserId: string | null;
  orgSlackConnected: boolean;
  slackTeamName: string | null;
};

// postMessage tag the Slack OAuth popup uses to hand its result back to the
// page that opened it (so only the Slack section refreshes, not the whole page).
const SLACK_CONNECT_MESSAGE = "slack-connect-result";

export default function ProfilePage() {
  const { data: session, update } = useSession();
  const { me } = useMe();
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [memberships, setMemberships] = useState<Membership[]>([]);
  // Teams I'm on, each with the roles I play there (roles are per-team now).
  const [teams, setTeams] = useState<ApiTeamRole[]>([]);
  // The team whose roles the editor is showing. Defaults to the first team
  // once they load ("" only while I'm on no teams at all).
  const [selectedTeamId, setSelectedTeamId] = useState("");
  // True while a leave is in flight (shows inline dots).
  const [savingRoles, setSavingRoles] = useState(false);
  // OAuth-only accounts (e.g. Google) have no password to change.
  const [hasPassword, setHasPassword] = useState(true);
  // Daily morning Slack digest, on by default. The send time is fixed, so this
  // on/off switch is the whole setting (see lib/digest.ts).
  const [dailyDigest, setDailyDigest] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  // Briefly true right after a successful save so the status line can flash a
  // "Saved ✓" confirmation.
  const [saved, setSaved] = useState(false);
  // Snapshot of the last-persisted fields, so an auto-save that would be a
  // no-op (e.g. tabbing out of an unchanged input) is skipped.
  const savedKeyRef = useRef("");
  // Holds the "hide the ✓" timer so each save restarts the full 2s window
  // (otherwise an earlier timer fires early and cuts a later check short).
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Password-change modal state.
  const [pwOpen, setPwOpen] = useState(false);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  // When this page is the Slack OAuth popup (the callback redirected us here
  // with ?slack=<status>), hand the result to the opener and close — so the
  // opener refreshes just its Slack section instead of the whole page reloading.
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("slack");
    if (status && window.opener) {
      window.opener.postMessage(
        { type: SLACK_CONNECT_MESSAGE, status },
        window.location.origin
      );
      window.close();
    }
  }, []);

  // Seed the form from the shared profile (fetched once by AuthGate via
  // MeProvider) instead of a second /api/me on mount. AuthGate holds the splash
  // until that fetch resolves, so `me` is populated by the time we render.
  useEffect(() => {
    if (!me) return;
    setName(me.name);
    setEmail(me.email ?? "");
    setMemberships(me.memberships ?? []);
    setTeams(me.teams ?? []);
    setHasPassword(me.hasPassword);
    setDailyDigest(me.dailyDigest);
    savedKeyRef.current = fieldsKey(me.name, me.email ?? "");
    setLoaded(true);
  }, [me]);

  // Always have a team selected: pick the first one, and re-point at it if the
  // selected team disappears (e.g. after leaving it).
  useEffect(() => {
    setSelectedTeamId((prev) =>
      teams.some((t) => t.id === prev) ? prev : (teams[0]?.id ?? "")
    );
  }, [teams]);

  // This panel is a read-only list: the teams I'm on and the roles I play on
  // them are both an org admin's to change, from the Team tab. Leaving is the
  // only write left here, and only an admin of that team's org (or a platform
  // super-admin) gets it — the API enforces the same rule.
  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;
  const isSuperAdmin = Boolean(session?.user?.isSuperAdmin);
  // Admin of ONE org — a team is only mine to change if I run the org it's in.
  const canManageTeamsIn = (orgId?: string) =>
    isSuperAdmin || memberships.some((m) => m.isAdmin && m.orgId === orgId);
  // Disambiguate teams by org only when I belong to more than one org.
  const teamLabel = (name: string, orgId?: string) => {
    if (memberships.length <= 1) return name;
    const org = memberships.find((m) => m.orgId === orgId)?.orgName;
    return org ? `${name} (${org})` : name;
  };

  async function leaveTeam(teamId: string) {
    setSavingRoles(true);
    try {
      await fetch(`/api/me/teams/${teamId}`, { method: "DELETE" });
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
      setSelectedTeamId("");
      window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
    } finally {
      setSavingRoles(false);
    }
  }

  // Flip the daily-digest preference. Optimistic (the checkbox responds at
  // once) and reverted if the PUT fails, like the role toggles above.
  async function saveDailyDigest(next: boolean) {
    const prev = dailyDigest;
    setDailyDigest(next);
    try {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // name is required by the endpoint, so send the current one through.
        body: JSON.stringify({ name, email: email || null, dailyDigest: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setDailyDigest(prev);
      setMessage("Error: could not save that");
    }
  }

  // Stable identity for the name/email fields, to detect no-op saves.
  function fieldsKey(n: string, e: string) {
    return JSON.stringify([n.trim(), (e || "").trim()]);
  }

  // Auto-save name/email (roles save separately via their own endpoint).
  async function saveProfile(
    overrides: { name?: string; email?: string | null } = {}
  ) {
    const payload = {
      name: overrides.name ?? name,
      email: overrides.email ?? (email || null),
    };
    // Name is required — never PUT a blank one (it'd 400 and read as a random
    // error on an unrelated action).
    if (!payload.name.trim()) {
      setMessage("Error: name is required");
      return;
    }
    const key = fieldsKey(payload.name, payload.email ?? "");
    if (key === savedKeyRef.current) return; // nothing actually changed

    setMessage("");
    setSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const [prevName] = JSON.parse(savedKeyRef.current || '["",""]') as [
          string,
          string,
        ];
        savedKeyRef.current = key;
        setSaved(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 2000);
        // Refresh the JWT (and, via the session change, the navbar) only when
        // the name — the one profile field the navbar shows — actually changed.
        if (payload.name.trim() !== prevName) {
          await update({ name: payload.name });
        }
      } else {
        const data = await res.json();
        setMessage(`Error: ${data.error ?? "could not save"}`);
      }
    } finally {
      setSaving(false);
    }
  }

  function openPasswordModal() {
    setPw1("");
    setPw2("");
    setPwError("");
    setPwOpen(true);
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwError("");
    if (pw1.length < 8) {
      setPwError("Password must be at least 8 characters.");
      return;
    }
    if (pw1 !== pw2) {
      setPwError("Passwords don't match.");
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: email || null, password: pw1 }),
      });
      if (res.ok) {
        setPwOpen(false);
        setMessage("Password updated.");
      } else {
        const data = await res.json();
        setPwError(data.error ?? "Could not update password.");
      }
    } finally {
      setPwSaving(false);
    }
  }

  // Full-page loader only for the initial load — the Save button shows inline
  // dots while saving.
  usePageLoading(!loaded);
  if (!loaded) return null;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">Edit Profile</h1>
      <Card>
        {/* No Save button: changes persist as you make them — roles save on
            click, name/email on blur. Enter in a text field saves too. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveProfile();
          }}
          className="space-y-4"
        >
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Account
            </h2>
            {/* Name/email save on blur — show the same in-flight/saved feedback. */}
            {saving ? (
              <LoadingDots size="sm" />
            ) : saved ? (
              <span className="text-green-600" aria-label="Saved">
                ✓
              </span>
            ) : null}
          </div>
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => saveProfile()}
            required
          />
          <div>
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => saveProfile()}
              placeholder="you@example.com"
              // Google (OAuth-only) accounts use their Google email to sign in,
              // so it can't be edited here.
              disabled={!hasPassword}
            />
            {!hasPassword && (
              <p className="mt-1 text-xs text-gray-500">
                Managed by your Google account.
              </p>
            )}
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Password
            </span>
            {hasPassword ? (
              <Button
                type="button"
                variant="secondary"
                onClick={openPasswordModal}
              >
                Change password
              </Button>
            ) : (
              // Google (OAuth-only) accounts have no password to change.
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" disabled>
                  Change password
                </Button>
                <span className="text-sm text-gray-500">
                  (signed in with Google)
                </span>
              </div>
            )}
          </div>

          {/* Errors and one-off notices (e.g. "Password updated."). The
              transient saving/saved status now sits by the Instruments header. */}
          {message && (
            <div className="flex h-5 items-center text-sm font-medium">
              <span
                className={
                  message.startsWith("Error") ? "text-red-600" : "text-green-600"
                }
              >
                {message}
              </span>
            </div>
          )}
        </form>
      </Card>

      {/* Teams & roles — its own panel. Pick a team to see the roles you play
          on it. A list, not an editor: an admin decides both which teams you're
          on and what you play on them, from the Team tab. Only "Leave this
          team" is offered, and only to an admin of that team's org. */}
      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            <span>Teams &amp; roles</span>
            <InfoTooltip text="The teams you're on and the roles you play on them are both set by your org admin. If something here looks wrong, contact them to have it changed." />
            {savingRoles ? (
              <LoadingDots size="sm" />
            ) : saved ? (
              <span
                className="text-green-600"
                aria-label="Saved"
                data-testid="profile-saved"
              >
                ✓
              </span>
            ) : null}
          </h2>
        </div>

        {teams.length === 0 ? (
          // A banner rather than a line of gray text: being on no team means
          // you can't be scheduled at all, which is worth noticing.
          <Banner tone="amber" inset>
            You’re not on any teams right now. Ask your organization’s admin to
            be put on a team.
          </Banner>
        ) : (
          <>
            <Select
              label="Team"
              hideLabel
              data-testid="profile-team-select"
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {teamLabel(t.name, t.orgId)}
                  {t.active === false ? " (inactive)" : ""}
                </option>
              ))}
            </Select>

            {selectedTeam ? (
              <div className="mt-3">
                {/* An admin has paused you on this team: your roles stay, but
                    the auto-scheduler skips you here until they switch it back. */}
                {selectedTeam.active === false && (
                  <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                    You’re marked <strong>inactive</strong> on this team, so you
                    won’t be scheduled on its sets. Ask an admin to reactivate
                    you.
                  </p>
                )}
                {/* The roles I hold on this team, in the team's own catalog
                    order. Read-only: every role here is an admin's to grant or
                    take away (the rule MD always had, now the rule for all of
                    them), so this lists what I hold rather than offering the
                    whole catalog to check. */}
                {selectedTeam.roles.length > 0 ? (
                  <div
                    className="flex flex-wrap gap-1.5"
                    data-testid="profile-roles"
                  >
                    {orderedRoles(selectedTeam.catalog ?? DEFAULT_TEAM_ROLES)
                      .filter((role) => selectedTeam.roles.includes(role.key))
                      .map((role) => (
                        <Badge key={role.key} tone="gray">
                          {role.label}
                        </Badge>
                      ))}
                  </div>
                ) : (
                  <p
                    className="text-sm text-gray-500 dark:text-gray-400"
                    data-testid="profile-roles"
                  >
                    No roles on this team yet — ask your org admin to add the
                    ones you play so you can be scheduled.
                  </p>
                )}
                {canManageTeamsIn(selectedTeam.orgId) && (
                  <button
                    type="button"
                    onClick={() => leaveTeam(selectedTeam.id)}
                    className="mt-3 text-sm text-red-600 hover:underline dark:text-red-400"
                  >
                    Leave this team
                  </button>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-500">
                Pick a team above to see the roles you play on it.
              </p>
            )}
          </>
        )}
      </Card>

      <SlackConnections
        initial={memberships}
        dailyDigest={dailyDigest}
        onDailyDigestChange={saveDailyDigest}
      />

      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title="Change password">
        <form onSubmit={changePassword} className="space-y-4">
          <Input
            label="New password"
            type="password"
            value={pw1}
            onChange={(e) => setPw1(e.target.value)}
            autoComplete="new-password"
            required
          />
          <Input
            label="Confirm new password"
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
            required
          />
          {pwError && <p className="text-sm text-red-600">{pwError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPwOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pwSaving}>
              {pwSaving ? <LoadingDots size="sm" /> : "Update password"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// Per-org Slack linking. Each org the user belongs to gets a row: the current
// member id (connected/not), a one-click Connect button (Flow A OAuth, which
// prefills the workspace), and a manual id field as the fallback.
// Human-readable outcome for each ?slack=<status> the connect callback returns.
const SLACK_RESULTS: Record<string, { text: string; ok: boolean }> = {
  connected: { text: "Connected ✓", ok: true },
  duplicate: {
    text: "That Slack account is already linked to someone else in this org.",
    ok: false,
  },
  wrong_workspace: {
    text: "That was a different Slack workspace than this org uses.",
    ok: false,
  },
  forbidden: { text: "Couldn't verify your session — please try again.", ok: false },
  error: { text: "Slack connection failed — please try again.", ok: false },
};

function SlackConnections({
  initial,
  dailyDigest,
  onDailyDigestChange,
}: {
  initial: Membership[];
  dailyDigest: boolean;
  onDailyDigestChange: (next: boolean) => void;
}) {
  const [rows, setRows] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // orgId whose OAuth popup is open (its button shows a spinner); null = idle.
  const [connecting, setConnecting] = useState<string | null>(null);
  // Transient per-org outcome shown after a flow (mainly to surface errors —
  // success is already visible in the row's "Connected ✓" line).
  const [note, setNote] = useState<{ orgId: string; text: string; ok: boolean } | null>(null);
  useEffect(() => setRows(initial), [initial]);

  // Re-pull just this org's Slack link after a successful connect, so only this
  // row updates rather than reloading the page.
  async function refreshOrg(orgId: string) {
    const me = await fetch("/api/me")
      .then((r) => r.json())
      .catch(() => null);
    const updated: Membership | undefined = me?.memberships?.find(
      (m: Membership) => m.orgId === orgId
    );
    if (updated) setRows((rs) => rs.map((r) => (r.orgId === orgId ? updated : r)));
  }

  // Start Flow A in a popup so the page underneath stays put. When the popup
  // finishes it postMessages its result back (see ProfilePage's popup handler);
  // we also poll popup.closed in case the user dismisses it without finishing.
  function connect(orgId: string) {
    const url = `/api/slack/connect?orgId=${orgId}`;
    const popup = window.open(url, "slack_connect", "width=600,height=760");
    // Popups blocked → fall back to the old full-page redirect.
    if (!popup) {
      window.location.href = url;
      return;
    }
    setConnecting(orgId);
    setNote(null);

    let timer: ReturnType<typeof setInterval>;
    const finish = (status?: string) => {
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
      setConnecting(null);
      if (status) {
        const result = SLACK_RESULTS[status] ?? SLACK_RESULTS.error;
        setNote({ orgId, ...result });
        if (result.ok) refreshOrg(orgId);
      }
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== SLACK_CONNECT_MESSAGE) return;
      finish(String(e.data.status ?? ""));
    };
    window.addEventListener("message", onMessage);
    timer = setInterval(() => {
      if (popup.closed) finish();
    }, 500);
  }

  async function saveManual(orgId: string) {
    const value = drafts[orgId] ?? "";
    const res = await fetch(`/api/memberships/${orgId}/slack`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slackUserId: value || null }),
    });
    if (res.ok) {
      const { slackUserId } = await res.json();
      setRows((rs) => rs.map((r) => (r.orgId === orgId ? { ...r, slackUserId } : r)));
      setDrafts((d) => ({ ...d, [orgId]: "" }));
    }
  }

  if (rows.length === 0) return null;

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">Slack</h2>
      <p className="mb-4 text-sm text-gray-500">
        Connect Slack per organization so the bot can DM you about assignments,
        swaps, and availability. Member IDs are different in each workspace.
      </p>

      {/* Daily digest opt-out. Lives here because Slack is how it's delivered —
          it does nothing until at least one org below is connected. */}
      <div className="mb-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
        <Checkbox
          label="Daily morning summary"
          checked={dailyDigest}
          onChange={(e) => onDailyDigestChange(e.target.checked)}
        />
        <p className="mt-1 text-xs text-gray-500">
          {rows.some((m) => m.slackUserId)
            ? "A short DM listing what needs you that day — sets, confirmations, and availability. Nothing is sent on days you're all clear."
            : "Connect Slack below to start receiving it. A short DM listing what needs you that day — sets, confirmations, and availability."}
        </p>
      </div>

      <div className="space-y-4">
        {rows.map((m) => (
          <div
            key={m.orgId}
            className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{m.orgName}</p>
                <p className="text-xs text-gray-500">
                  {m.slackUserId ? (
                    <span className="text-green-600">Connected ✓ ({m.slackUserId})</span>
                  ) : m.orgSlackConnected ? (
                    "Not connected"
                  ) : (
                    "Slack isn't set up for this org yet. Tell your admin to do so."
                  )}
                </p>
                {note?.orgId === m.orgId && !note.ok && (
                  <p className="mt-1 text-xs text-red-600">{note.text}</p>
                )}
              </div>
              {m.orgSlackConnected && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={connecting === m.orgId}
                  onClick={() => connect(m.orgId)}
                >
                  {connecting === m.orgId ? (
                    <LoadingDots size="sm" />
                  ) : m.slackUserId ? (
                    "Reconnect"
                  ) : (
                    "Connect Slack"
                  )}
                </Button>
              )}
            </div>
            {/* A member ID is only useful once the org's bot is installed —
                otherwise there's nothing to DM through, so hide the field. */}
            {m.orgSlackConnected && (
              <div className="mt-2 flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    label="Or enter your member ID manually"
                    value={drafts[m.orgId] ?? ""}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [m.orgId]: e.target.value }))
                    }
                    placeholder={m.slackUserId ?? "e.g. U0123ABCDEF"}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => saveManual(m.orgId)}
                >
                  Save
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
