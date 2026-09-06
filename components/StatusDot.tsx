"use client";
// The little colored dot that says how a set's roster is doing: red when it
// needs an admin (a cover request, or slots nobody fills), amber while someone
// still hasn't confirmed, green once everyone has. See lib/setStatus.ts for
// the rule itself.
//
// Its own component because the same dot appears in two places — the month
// grid's set chips and the "My sets" list on a phone — and a colour that means
// one thing in one view and another elsewhere would be worse than no colour.
// Colour alone can't say WHICH red it is, so every dot carries the words too.
import { setStatus, type SetStatus, type StatusSet } from "@/lib/setStatus";

const STATUS_TITLES: Record<SetStatus, string> = {
  cover: "Cover requested",
  understaffed: "Needs people — open slots",
  unconfirmed: "Waiting on confirmations",
  confirmed: "Fully confirmed",
};

const STATUS_COLORS: Record<SetStatus, string> = {
  // Both reds are "an admin has to do something" — the filters tell them
  // apart, the dot deliberately doesn't.
  cover: "bg-red-500",
  understaffed: "bg-red-500",
  unconfirmed: "bg-amber-500",
  confirmed: "bg-green-500",
};

export default function StatusDot({
  set,
  // Size/spacing is the caller's: the calendar's chips are tiny, a list row
  // can afford a bigger dot.
  className = "h-1.5 w-1.5",
}: {
  set: StatusSet;
  className?: string;
}) {
  const status = setStatus(set);
  return (
    <span
      title={STATUS_TITLES[status]}
      aria-label={STATUS_TITLES[status]}
      className={`shrink-0 rounded-full ${STATUS_COLORS[status]} ${className}`}
    />
  );
}
