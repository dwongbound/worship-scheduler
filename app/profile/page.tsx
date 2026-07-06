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
import {
  INSTRUMENT_LABELS,
  ROLE_ORDER,
  type Instrument,
} from "@/lib/constants";

export default function ProfilePage() {
  const { update } = useSession();
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [slackUserId, setSlackUserId] = useState("");
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

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
        setSlackUserId(me.slackUserId ?? "");
        setInstruments(me.instruments);
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
      slackUserId: slackUserId || null,
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
        // Refresh the JWT so the navbar shows the new name immediately.
        await update({ name });
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
          <Input
            label="Slack member ID (for future Slack integration)"
            value={slackUserId}
            onChange={(e) => setSlackUserId(e.target.value)}
            placeholder="e.g. U0123ABCDEF"
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
          <Button type="submit" disabled={saving}>
            {saving ? <LoadingDots size="sm" /> : "Save changes"}
          </Button>
        </form>
      </Card>

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
