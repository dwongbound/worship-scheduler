"use client";
// The navbar org dropdown, next to the profile menu. Its behavior depends on
// the page:
//   /calendar, /swaps — a VIEW filter: "All orgs" + each of my orgs.
//   /create, /users   — the ADMIN org: exactly one of my admin orgs (no All).
//   /schedule         — locked to "All orgs" (busy blocks span every org): the
//                       menu lists the orgs greyed-out/disabled with an (i)
//                       note explaining the lock; "Org settings" + "Add an
//                       org…" still work.
// Every mode ends with "Org settings" (admins only, hidden on phones — it opens
// the full-page /orgs view) and "Add an org…", which prompts for an org key.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";
import Button from "./common/Button";
import Dropdown from "./common/Dropdown";
import InfoTooltip from "./common/InfoTooltip";
import Input from "./common/Input";
import Modal from "./common/Modal";
import { ORGS_CHANGED_EVENT, useOrgs } from "./OrgProvider";

// Which selection a path drives (must match the pages' own fetch wiring).
function modeFor(pathname: string): "view" | "admin" | "locked" {
  if (pathname.startsWith("/create") || pathname.startsWith("/users")) {
    return "admin";
  }
  if (pathname.startsWith("/schedule")) return "locked";
  return "view";
}

export default function OrgSwitcher() {
  const pathname = usePathname();
  const { update } = useSession();
  const { orgs, viewOrgId, setViewOrg, adminOrgId, setAdminOrg } = useOrgs();
  const [addOpen, setAddOpen] = useState(false);
  const [orgKey, setOrgKey] = useState("");
  const [addError, setAddError] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  if (!orgs) return null; // first load — the navbar renders without it briefly

  const mode = modeFor(pathname);
  const adminOrgs = orgs.filter((o) => o.isAdmin);
  // "Org settings" is only useful to someone who administers an org; the item
  // links to the full-page /orgs view where they pick which one.
  const canManageOrgs = adminOrgs.length > 0;

  const label =
    mode === "locked"
      ? "All orgs"
      : mode === "admin"
        ? adminOrgs.find((o) => o.id === adminOrgId)?.name ?? "Pick an org"
        : viewOrgId === "all"
          ? "All orgs"
          : orgs.find((o) => o.id === viewOrgId)?.name ?? "All orgs";

  async function addOrg() {
    setAddBusy(true);
    setAddError("");
    try {
      const res = await fetch("/api/orgs/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: orgKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddError(data.error ?? "Could not join the organization.");
        return;
      }
      setAddOpen(false);
      setOrgKey("");
      // Refresh the JWT membership hints (tab visibility) + this dropdown.
      await update();
      window.dispatchEvent(new Event(ORGS_CHANGED_EVENT));
    } finally {
      setAddBusy(false);
    }
  }

  const itemClass = (selected: boolean) =>
    `block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
      selected ? "font-semibold text-indigo-600 dark:text-indigo-400" : ""
    }`;

  const trigger = (
    <span
      data-testid="org-switcher"
      data-tour="orgs"
      className="flex h-9 max-w-36 items-center gap-1 rounded-lg border border-gray-300 px-2.5
        text-sm font-medium hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
    >
      <span className="truncate">{label}</span>
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4 shrink-0">
        <path
          fillRule="evenodd"
          d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.23 8.27a.75.75 0 01.02-1.06z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  );

  // Shared menu tail, as one bordered group so there's a single divider above
  // it (no stray borders / empty rows). "Org settings" is admins-only and
  // hidden on phones (the full-page view is desktop-oriented).
  const menuTail = (
    <div className="border-t border-gray-200 dark:border-gray-700">
      {canManageOrgs && (
        <Link
          href="/orgs"
          className="hidden w-full px-4 py-2 text-left text-sm text-gray-500
            hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 sm:block"
        >
          ⚙ Org settings
        </Link>
      )}
      <button
        onClick={() => {
          setAddError("");
          setOrgKey("");
          setAddOpen(true);
        }}
        className="block w-full px-4 py-2 text-left text-sm text-gray-500
          hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
      >
        + Add an org…
      </button>
    </div>
  );

  return (
    <>
      <Dropdown
        trigger={trigger}
        // Locked mode has an (i) hover popover next to "All orgs" that needs to
        // escape the panel; other modes keep the default clipped corners.
        menuClassName={mode === "locked" ? "overflow-visible" : "overflow-hidden"}
      >
        {/* View mode: "All orgs" + each org, all selectable filters. */}
        {mode === "view" && (
          <button onClick={() => setViewOrg("all")} className={itemClass(viewOrgId === "all")}>
            All orgs
          </button>
        )}
        {mode !== "locked" &&
          (mode === "admin" ? adminOrgs : orgs).map((org) => (
            <button
              key={org.id}
              onClick={() => (mode === "admin" ? setAdminOrg(org.id) : setViewOrg(org.id))}
              className={itemClass(
                mode === "admin" ? adminOrgId === org.id : viewOrgId === org.id
              )}
            >
              {org.name}
            </button>
          ))}

        {/* Locked (Availabilities): "All orgs" is the active, unchangeable
            filter, with an (i) hover popover to its right explaining the lock;
            the individual orgs are shown disabled below. */}
        {mode === "locked" && (
          <>
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400"
            >
              All orgs
              <InfoTooltip
                side="bottom"
                text="Availabilities always covers all your orgs, so this filter can’t be narrowed to one."
              />
            </div>
            {orgs.map((org) => (
              <div
                key={org.id}
                aria-disabled
                onClick={(e) => e.stopPropagation()}
                className="cursor-not-allowed px-4 py-2 text-sm text-gray-400 dark:text-gray-500"
              >
                {org.name}
              </div>
            ))}
          </>
        )}

        {menuTail}
      </Dropdown>

      {addOpen && (
        <Modal open onClose={() => setAddOpen(false)} title="Add an organization">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addOrg();
            }}
            className="space-y-4"
          >
            <Input
              label="Organization key"
              value={orgKey}
              onChange={(e) => setOrgKey(e.target.value)}
              autoComplete="off"
              autoFocus
              required
            />
            {addError && <p className="text-sm text-red-600">{addError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addBusy || !orgKey.trim()}>
                {addBusy ? "Joining…" : "Join"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
