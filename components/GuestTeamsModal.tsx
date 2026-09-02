"use client";
// "Other teams" — which OTHER teams lend people to one set, and which of their
// roles it borrows. (Called "guest teams" throughout the code and the API,
// which is the name the schema uses; "Other teams" is only the label.)
//
// A set always keeps one owning team (its Slack channel, availability requests
// and org anchor never move). A guest only widens who may sit in which seats:
// tick a team, then tick the roles you want from ITS catalog. Each borrowed
// role is either a fixed count of seats, or "as many as available" — an
// unbounded list with no target, which is what the old hardcoded choir was.
//
// The editor works on a local draft and saves the whole list at once, so a
// half-configured guest never reaches the server.
import { useEffect, useState } from "react";
import Modal from "./common/Modal";
import Button from "./common/Button";
import Checkbox from "./common/Checkbox";
import LoadingDots from "./common/LoadingDots";
import { MAX_SLOTS_PER_ROLE } from "@/lib/constants";
import { slottedRoles } from "@/lib/teamRoles";
import type { GuestRoleSpec } from "@/lib/guestTeams";
import type { ApiTeam } from "@/lib/types";

/** One team's borrowed roles, as the editor holds them. */
export interface GuestTeamDraft {
  teamId: string;
  roles: GuestRoleSpec[];
}

export default function GuestTeamsModal({
  open,
  onClose,
  teams,
  value,
  seatedCount,
  onSave,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  // Teams eligible to guest: this org's teams, minus the set's own.
  teams: ApiTeam[];
  value: GuestTeamDraft[];
  // How many people already sit in a given borrowed seat. Used as a floor so
  // an edit can never orphan someone who's already been booked.
  seatedCount: (teamId: string, role: string) => number;
  onSave: (next: GuestTeamDraft[]) => void;
  busy?: boolean;
}) {
  const [draft, setDraft] = useState<GuestTeamDraft[]>(value);

  // Reseed whenever the modal (re)opens, so a cancelled edit doesn't persist
  // into the next open.
  useEffect(() => {
    if (open) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const entryFor = (teamId: string) => draft.find((d) => d.teamId === teamId);
  // Anyone seated under this team, across all its borrowed roles.
  const seatedOnTeam = (team: ApiTeam) =>
    slottedRoles(team.roles ?? []).reduce(
      (n, r) => n + seatedCount(team.id, r.key),
      0
    );

  const toggleTeam = (team: ApiTeam, on: boolean) =>
    setDraft((d) =>
      on
        ? [...d, { teamId: team.id, roles: [] }]
        : d.filter((e) => e.teamId !== team.id)
    );

  // Replace one role's spec within one team (or drop it when `spec` is null).
  const setRole = (teamId: string, role: string, spec: GuestRoleSpec | null) =>
    setDraft((d) =>
      d.map((e) =>
        e.teamId !== teamId
          ? e
          : {
              ...e,
              roles: spec
                ? [...e.roles.filter((r) => r.role !== role), spec]
                : e.roles.filter((r) => r.role !== role),
            }
      )
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Other teams"
      subtitle="Borrow another team's people for this set"
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            // Drop teams with no roles ticked — an empty guest row would show
            // an empty block on the set for no reason.
            onClick={() => onSave(draft.filter((e) => e.roles.length > 0))}
            disabled={busy}
          >
            {busy ? <LoadingDots size="sm" /> : "Save"}
          </Button>
        </>
      }
    >
      {teams.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          This org has no other teams to borrow from yet.
        </p>
      ) : (
        <div className="space-y-4">
          {teams.map((team) => {
            const entry = entryFor(team.id);
            const seated = seatedOnTeam(team);
            return (
              <div
                key={team.id}
                className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
              >
                {/* A team with people already seated can't simply be removed —
                    they'd be left on the set with nothing explaining why they
                    were there. Same rule the roster uses for occupied slots. */}
                <Checkbox
                  label={team.name}
                  checked={!!entry}
                  disabled={busy || (!!entry && seated > 0)}
                  title={
                    entry && seated > 0
                      ? "Remove their people from the set first."
                      : undefined
                  }
                  onChange={(e) => toggleTeam(team, e.target.checked)}
                />

                {entry && (
                  <div className="mt-3 space-y-2 border-t border-gray-200 pt-3 pl-6 dark:border-gray-700">
                    {slottedRoles(team.roles ?? []).map((role) => {
                      const spec = entry.roles.find((r) => r.role === role.key);
                      const unbounded = spec?.allAvailable === true;
                      const floor = seatedCount(team.id, role.key);
                      return (
                        <div
                          key={role.key}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1"
                        >
                          <span className="w-32 shrink-0 text-sm text-gray-700 dark:text-gray-300">
                            {role.label}
                          </span>

                          <input
                            type="number"
                            min={floor}
                            max={MAX_SLOTS_PER_ROLE}
                            aria-label={`${team.name} ${role.label} seats`}
                            // Unbounded has no number to show; blank it out and
                            // let the tick own the seat instead.
                            value={unbounded ? "" : (spec?.count ?? 0)}
                            disabled={busy || unbounded}
                            title={
                              floor > 0
                                ? `${floor} already seated — remove them from the set to go lower.`
                                : undefined
                            }
                            onChange={(e) => {
                              const n = Math.max(
                                floor,
                                Math.min(
                                  MAX_SLOTS_PER_ROLE,
                                  Math.floor(Number(e.target.value) || 0)
                                )
                              );
                              // 0 seats and no tick = not borrowing this role.
                              setRole(
                                team.id,
                                role.key,
                                n === 0 ? null : { role: role.key, count: n }
                              );
                            }}
                            className="w-16 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm
                              focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
                              disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800"
                          />

                          {/* The unbounded seat: no target count, so it never
                              reads as a hole on the calendar, and "Auto
                              schedule" seats everyone free instead of a
                              balanced few. */}
                          <Checkbox
                            label="Add as many available"
                            checked={unbounded}
                            disabled={busy}
                            onChange={(e) =>
                              setRole(
                                team.id,
                                role.key,
                                e.target.checked
                                  ? { role: role.key, allAvailable: true }
                                  : floor > 0
                                    ? { role: role.key, count: floor }
                                    : null
                              )
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
