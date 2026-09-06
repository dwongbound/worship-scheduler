"use client";
// Org settings → Notifications: one switch per kind of personal DM the bot
// sends, so an org can quiet the messages it doesn't want without turning Slack
// off entirely. Admin-only, and keyed on orgId by the parent so it remounts on
// an org switch.
//
// The catalog and the "unset means on" rule live in lib/notificationPrefs.ts —
// this only draws it. Saves are optimistic (the switch moves at once and rolls
// back if the API refuses) and send ONLY the row that changed, which the PATCH
// merges over what's stored.
import { useEffect, useState } from "react";
import InfoTooltip from "@/components/common/InfoTooltip";
import Toggle from "@/components/common/Toggle";
import {
  NOTIFICATION_TYPES,
  notificationEnabled,
  type NotificationPrefs,
  type NotificationType,
} from "@/lib/notificationPrefs";

export default function OrgNotifications({ orgId }: { orgId: string }) {
  // null = not loaded yet (same convention as the page's joinKey/digest state).
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [busyKey, setBusyKey] = useState<NotificationType | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setPrefs(null);
    setError("");
    fetch(`/api/orgs/${orgId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setPrefs(data.notificationPrefs ?? {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  async function toggle(key: NotificationType, next: boolean) {
    const previous = prefs ?? {};
    setPrefs({ ...previous, [key]: next });
    setBusyKey(key);
    setError("");
    try {
      const res = await fetch(`/api/orgs/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationPrefs: { [key]: next } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPrefs(previous);
        setError(data.error ?? "Could not save that setting.");
        return;
      }
      setPrefs(data.notificationPrefs ?? {});
    } catch {
      setPrefs(previous);
      setError("Could not save that setting.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <p className="text-sm font-medium">Notifications</p>
        <InfoTooltip text="Switching one off stops that kind of message for everyone in this org — nothing else changes, and people can still see it all in the app. Set group chats and weekly team summaries are posted to channels, so they aren't affected." />
      </div>
      <p className="mb-3 text-sm text-gray-500">
        What the bot DMs people about.
      </p>

      {prefs === null ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <ul className="space-y-2">
          {NOTIFICATION_TYPES.map((type) => (
            <li
              key={type.key}
              className="flex items-center justify-between gap-4 rounded-lg border
                border-gray-200 px-3 py-2.5 dark:border-gray-700"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="truncate text-sm font-medium">{type.label}</p>
                {/* The "what this actually sends" line lives on hover — eight
                    paragraphs stacked down the page buried the switches. */}
                <InfoTooltip text={type.description} />
              </div>
              <div className="shrink-0">
                <Toggle
                  label={type.label}
                  hideLabel
                  checked={notificationEnabled(prefs, type.key)}
                  disabled={busyKey !== null}
                  onChange={(next) => toggle(type.key, next)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
