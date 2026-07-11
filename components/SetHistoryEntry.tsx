"use client";
// One line in a set's activity log (the History section of SetDetailModal),
// rendered as two rows:
//   • who acted, with the timestamp in parentheses
//   • what changed — connective text muted, every person shown as a chip
//     (struck through when they were removed or replaced)
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
  const { actor, actorMuted, tokens } = describeSetHistoryEvent(event);

  return (
    <li>
      {/* Row 1: actor chip + muted timestamp. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <Chip name={actor} muted={actorMuted} />
        <span className="text-xs text-gray-400 dark:text-gray-500">
          ({formatDay(event.createdAt)} · {formatTime(event.createdAt)})
        </span>
      </div>
      {/* Row 2: what changed — string tokens are muted text, object tokens
          are person chips. */}
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
