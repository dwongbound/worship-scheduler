"use client";
// One entry in a set's activity log (the History section of SetDetailModal),
// rendered as two rows:
//   • the date/time, followed by who did it in parentheses — all muted
//   • what happened — the change (connective text muted, every person a chip,
//     struck through when removed or replaced)
// Consecutive entries are separated by a divider (see the list in SetDetailModal).
import { formatDay, formatTime } from "@/lib/dates";
import { describeSetHistoryEvent } from "@/lib/setHistory";
import type { ApiSetHistoryEvent } from "@/lib/types";

// A person/system pill. `muted` = system (auto-scheduler); `struck` = the
// person was removed or swapped out.
function Chip({
  name,
  muted,
  struck,
}: {
  name: string;
  muted?: boolean;
  struck?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        muted
          ? "bg-gray-100 text-gray-500 dark:bg-gray-700/60 dark:text-gray-400"
          : "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300"
      } ${struck ? "line-through opacity-60" : ""}`}
    >
      {name}
    </span>
  );
}

export default function SetHistoryEntry({
  event,
}: {
  event: ApiSetHistoryEvent;
}) {
  const { actor, tokens } = describeSetHistoryEvent(event);

  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      {/* Row 1: date/time, then who did it in parentheses. */}
      <div className="text-xs text-gray-400 dark:text-gray-500">
        {formatDay(event.createdAt)} · {formatTime(event.createdAt)} ({actor})
      </div>
      {/* Row 2: what changed. String tokens are muted connective text; object
          tokens are person chips. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
        {tokens.map((token, i) =>
          typeof token === "string" ? (
            <span key={i}>{token}</span>
          ) : (
            <Chip key={i} name={token.name} struck={token.struck} />
          )
        )}
      </div>
    </li>
  );
}
