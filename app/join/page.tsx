"use client";
// Org-key gate: a signed-in account with no org memberships lands here
// (AuthGate redirects) and can't reach any page until it redeems a key.
// Keys are handed out by org admins (defined in the ORG_KEYS env var).
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";

export default function JoinPage() {
  const router = useRouter();
  const { update } = useSession();
  const [orgKey, setOrgKey] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/orgs/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: orgKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not join the organization.");
        return;
      }
      // Refresh the JWT's membership hints so the navbar tabs appear
      // immediately, then enter the app.
      await update();
      router.replace("/calendar");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-xl font-bold text-indigo-600 dark:text-indigo-400">
          Join your organization
        </h1>
        <p className="mb-6 text-center text-sm text-gray-500">
          Enter the organization key your admin shared with you.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <Input
            label="Organization key"
            value={orgKey}
            onChange={(e) => setOrgKey(e.target.value)}
            autoComplete="off"
            autoFocus
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Joining…" : "Join"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="mt-4 w-full text-center text-sm text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          Log out
        </button>
      </Card>
    </div>
  );
}
