"use client";
// Edit personal info: name, email, instruments, and a Slack member ID field
// for the future Slack integration. Password changes happen in a separate
// modal that requires typing the new password twice.
import { useSession } from "next-auth/react";
import { FormEvent, useEffect, useState } from "react";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Checkbox from "@/components/common/Checkbox";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Modal from "@/components/common/Modal";
import { usePageLoading } from "@/components/LoadingProvider";
import { PROFILE_CHANGED_EVENT } from "@/components/Navbar";
import {
  INSTRUMENT_LABELS,
  ROLE_ORDER,
  type Instrument,
} from "@/lib/constants";

type Membership = {
  orgId: string;
  orgName: string;
  slackUserId: string | null;
  orgSlackConnected: boolean;
  slackTeamName: string | null;
};

export default function ProfilePage() {
  const { update } = useSession();
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  // OAuth-only accounts (e.g. Google) have no password to change.
  const [hasPassword, setHasPassword] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  // Briefly true right after a successful save so the button can flash a
  // checkmark instead of its normal label.
  const [saved, setSaved] = useState(false);

  // Password-change modal state.
  const [pwOpen, setPwOpen] = useState(false);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((res) => res.json())
      .then((me) => {
        setName(me.name);
        setEmail(me.email ?? "");
        setMemberships(me.memberships ?? []);
        setInstruments(me.instruments);
        setHasPassword(me.hasPassword ?? true);
        setLoaded(true);
      });
  }, []);

  function toggleInstrument(inst: Instrument) {
    setInstruments((current) =>
      current.includes(inst)
        ? current.filter((i) => i !== inst)
        : [...current, inst]
    );
  }

  // The shared PUT body for the profile fields (used by save + password change).
  function profilePayload(extra: Record<string, unknown> = {}) {
    return {
      name,
      email: email || null,
      instruments,
      ...extra,
    };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profilePayload()),
      });
      if (res.ok) {
        setMessage("Saved!");
        // Flash the checkmark on the button, then revert to the normal label.
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        // Refresh the JWT so the navbar shows the new name immediately.
        await update({ name });
        // Tell the navbar to re-check the profile so the "finish setup"
        // reminder dot/banner clear the moment instruments are saved.
        window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
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
        body: JSON.stringify(profilePayload({ password: pw1 })),
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
        <form onSubmit={onSubmit} className="space-y-4">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              Instruments / roles
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {ROLE_ORDER.map((inst) => (
                <Checkbox
                  key={inst}
                  label={INSTRUMENT_LABELS[inst]}
                  checked={instruments.includes(inst)}
                  onChange={() => toggleInstrument(inst)}
                />
              ))}
            </div>
          </fieldset>

          {hasPassword && (
            <div>
              <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Password
              </span>
              <Button
                type="button"
                variant="secondary"
                onClick={openPasswordModal}
              >
                Change password
              </Button>
            </div>
          )}

          {message && (
            <p
              className={`text-sm font-medium ${
                message.startsWith("Error")
                  ? "text-red-600"
                  : "text-green-600"
              }`}
            >
              {message}
            </p>
          )}
          <Button type="submit" disabled={saving || saved}>
            {saving ? (
              <LoadingDots size="sm" />
            ) : saved ? (
              <>
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {/* dasharray 24 ≈ path length; the check-draw animation
                      sweeps dashoffset 24→0 so the tick appears to be drawn. */}
                  <path
                    d="M5 13l4 4L19 7"
                    strokeDasharray={24}
                    strokeDashoffset={24}
                    className="animate-check-draw"
                  />
                </svg>
                Saved
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </form>
      </Card>

      <SlackConnections initial={memberships} />

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
function SlackConnections({ initial }: { initial: Membership[] }) {
  const [rows, setRows] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => setRows(initial), [initial]);

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
                    "Slack isn't set up for this org yet"
                  )}
                </p>
              </div>
              {m.orgSlackConnected && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    window.location.href = `/api/slack/connect?orgId=${m.orgId}`;
                  }}
                >
                  {m.slackUserId ? "Reconnect" : "Connect Slack"}
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
