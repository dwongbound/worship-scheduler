"use client";
// The platform-admin UI (see page.tsx for the server-side guard). Lists orgs
// with their join keys + Slack status, creates new orgs, and rotates keys —
// all against /api/platform/orgs, no env edits or redeploys.
import { FormEvent, useEffect, useState } from "react";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import { usePageLoading } from "@/components/LoadingProvider";

type Org = {
  id: string;
  name: string;
  joinKey: string | null;
  memberCount: number;
  slackConnected: boolean;
  slackTeamName: string | null;
};

export default function PlatformClient() {
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [newName, setNewName] = useState("");
  const [newKey, setNewKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/platform/orgs");
    setOrgs(res.ok ? await res.json() : []);
  }
  useEffect(() => {
    load();
  }, []);

  async function createOrg(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/platform/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, joinKey: newKey || undefined }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? "Could not create org.");
        return;
      }
      setNewName("");
      setNewKey("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function rotateKey(id: string) {
    await fetch(`/api/platform/orgs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rotateKey: true }),
    });
    await load();
  }

  usePageLoading(orgs === null);
  if (orgs === null) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Platform admin</h1>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Create an organization</h2>
        <form onSubmit={createOrg} className="space-y-3">
          <Input
            label="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
          />
          <Input
            label="Join key (optional — generated if blank)"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="auto-generate"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={busy || !newName.trim()}>
            {busy ? <LoadingDots size="sm" /> : "Create org"}
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Organizations</h2>
        <div className="space-y-3">
          {orgs.map((o) => (
            <div
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
            >
              <div className="min-w-0">
                <p className="font-medium">{o.name}</p>
                <p className="text-xs text-gray-500">
                  {o.memberCount} member{o.memberCount === 1 ? "" : "s"} ·{" "}
                  {o.slackConnected
                    ? `Slack: ${o.slackTeamName ?? "connected"} ✓`
                    : "Slack: not connected"}
                </p>
                <p className="mt-1 font-mono text-xs">
                  key:{" "}
                  <button
                    type="button"
                    onClick={() => o.joinKey && navigator.clipboard.writeText(o.joinKey)}
                    className="rounded bg-gray-100 px-1.5 py-0.5 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
                    title="Click to copy"
                  >
                    {o.joinKey ?? "—"}
                  </button>
                </p>
              </div>
              <Button variant="secondary" onClick={() => rotateKey(o.id)}>
                Rotate key
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
