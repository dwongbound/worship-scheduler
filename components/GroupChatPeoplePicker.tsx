"use client";
// The extra people added to the Slack group chat of every set of ONE recurring
// set (a weekly set time) — a ministry lead who wants to be in every Sunday
// 10 AM chat without being on those sets. Chips for who's in, and a type-ahead
// to add more. Controlled: the weekly set time form owns the list and saves it
// with the rest of the time (SetTemplateChatMember).
import { useState } from "react";
import type { ApiAdminUser } from "@/lib/types";

export default function GroupChatPeoplePicker({
  users,
  selectedIds,
  onChange,
  disabled,
}: {
  users: ApiAdminUser[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");

  const chosen = selectedIds
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is ApiAdminUser => !!u);
  const trimmed = query.trim().toLowerCase();
  // Suggestions only once something is typed, and capped: the whole org's
  // roster is never rendered here.
  const matches = trimmed
    ? users
        .filter((u) => !selectedIds.includes(u.id))
        .filter((u) => u.name.toLowerCase().includes(trimmed))
        .slice(0, 6)
    : [];

  const close = () => {
    setAdding(false);
    setQuery("");
  };
  // Adding leaves the box open and empty, so several people go in in a row.
  const add = (u: ApiAdminUser) => {
    setQuery("");
    onChange([...selectedIds, u.id]);
  };

  return (
    <div>
      <p className="mb-1 text-sm font-medium">Also add to the group chat</p>
      <p className="mb-2 text-sm text-gray-500">
        Added to this set&rsquo;s Slack chat every week, even when they aren&rsquo;t on it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {chosen.map((u) => (
          <span
            key={u.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 py-1 pl-3 pr-1.5 text-sm font-medium text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200"
          >
            {u.name}
            {/* Skipped until they link Slack — worth saying, since adding them
                here looks like it's enough. */}
            {!u.slackConnected && (
              <span
                title="No Slack account linked yet — they'll be skipped until they link one."
                className="text-xs font-normal text-indigo-600/70 dark:text-indigo-300/70"
              >
                no Slack
              </span>
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(selectedIds.filter((id) => id !== u.id))}
              aria-label={`Remove ${u.name}`}
              title="Remove"
              className="flex h-4 w-4 items-center justify-center rounded-full text-indigo-600 transition-colors hover:bg-indigo-200 hover:text-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-500/40 dark:hover:text-white"
            >
              <svg viewBox="0 0 14 14" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
              </svg>
            </button>
          </span>
        ))}

        {adding ? (
          <div className="relative">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
                // Enter takes the top match; it must not submit the form.
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (matches[0]) add(matches[0]);
                }
              }}
              // The suggestions cancel this with onMouseDown, so a click lands.
              onBlur={close}
              placeholder="Start typing a name…"
              aria-label="Add someone to this set's group chat"
              className="w-56 rounded-full border border-gray-300 bg-white px-3 py-1 text-base sm:text-sm
                focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
                dark:border-gray-600 dark:bg-gray-800"
            />
            {query.trim() && (
              <ul className="absolute left-0 top-full z-10 mt-1 max-h-56 w-64 overflow-y-auto overscroll-contain rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                {matches.length === 0 ? (
                  <li className="px-3 py-1.5 text-sm text-gray-400">No matches.</li>
                ) : (
                  matches.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => add(u)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <span>{u.name}</span>
                        {!u.slackConnected && <span className="text-xs text-gray-400">(no Slack linked)</span>}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-400 px-3 py-1 text-sm text-gray-500 transition-colors hover:border-indigo-500 hover:text-indigo-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-indigo-400 dark:hover:text-indigo-300"
          >
            + Add person
          </button>
        )}
      </div>
    </div>
  );
}
