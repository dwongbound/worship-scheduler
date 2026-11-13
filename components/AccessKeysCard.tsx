"use client";
// /profile's "Personal access keys" card: let an assistant of the person's own
// (Jarvis) read their sets, the schedule, covers and availability requests
// through /api/mcp or /api/agent, and, for a key made with the box ticked,
// confirm their sets, ask for and withdraw cover, and take covers as them.
//
// Not part of the page's form: making and revoking a key happen on the spot,
// through their own routes. A new key is shown ONCE, right after it's made:
// the server keeps only its hash, and (as on vff-app) no part of it is ever
// shown again, not even a prefix. Its buttons are 44px tall on a phone
// (`min-h-11`), the app's touch target; the modal footer gets that on its own.
import { useEffect, useState } from "react";
import Banner from "@/components/common/Banner";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Checkbox from "@/components/common/Checkbox";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Modal from "@/components/common/Modal";
import { CAN_WRITE_LABEL, accessKeyLine } from "@/lib/accessKeyView";
import type { ApiAccessKey, ApiNewAccessKey } from "@/lib/types";

/** A JSON request to one of the key routes: its body, or the error to show. */
async function send<T>(url: string, method: string, body?: unknown) {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false as const, error: (data?.error as string) ?? null };
    return { ok: true as const, data: data as T };
  } catch {
    return { ok: false as const, error: null };
  }
}

export default function AccessKeysCard() {
  // null = still loading (or the list couldn't be read).
  const [keys, setKeys] = useState<ApiAccessKey[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  // Off by default: a key only reads unless the person says otherwise.
  const [canWrite, setCanWrite] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The key just made, until the person closes it. Never stored anywhere.
  const [fresh, setFresh] = useState<ApiNewAccessKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<ApiAccessKey | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  useEffect(() => {
    void send<ApiAccessKey[]>("/api/access-keys", "GET").then((result) => {
      if (result.ok && Array.isArray(result.data)) setKeys(result.data);
      else setLoadFailed(true);
    });
  }, []);

  /** Make a key from the name box and show it once. */
  async function create() {
    setError(null);
    setCreating(true);
    const result = await send<ApiNewAccessKey>("/api/access-keys", "POST", { name, canWrite });
    setCreating(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't make the key.");
      return;
    }
    // Everything but the key itself goes in the list.
    const { key: _key, ...listed } = result.data;
    setKeys((list) => [listed, ...(list ?? [])]);
    setFresh(result.data);
    setCopied(false);
    setName("");
    setCanWrite(false);
  }

  /** Copy the fresh key; a refused clipboard leaves it on screen to select. */
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  /** Close the revoke window without doing anything. */
  function closeRevoke() {
    if (revokeBusy) return;
    setRevoking(null);
    setRevokeError(null);
  }

  /** Revoke the key the confirm window is about. */
  async function revoke() {
    if (!revoking) return;
    setRevokeError(null);
    setRevokeBusy(true);
    const result = await send(`/api/access-keys/${revoking.id}`, "DELETE");
    setRevokeBusy(false);
    if (!result.ok) {
      setRevokeError(result.error ?? "Couldn't revoke the key.");
      return;
    }
    setKeys((list) => (list ?? []).filter((k) => k.id !== revoking.id));
    if (fresh?.id === revoking.id) setFresh(null);
    setRevoking(null);
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <Card className="space-y-3" data-testid="access-keys">
      <div>
        <h2 className="mb-1 text-lg font-semibold">Personal access keys</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Let an assistant of yours, like Jarvis, read your sets, the upcoming
          schedule, covers you could take and your availability requests. Turn
          on acting for you if you also want it to confirm your sets, ask for
          cover and take covers, as you. No key can change a roster or your
          availability. Revoke a key here any time.
        </p>
      </div>

      {keys === null && !loadFailed && (
        <div className="flex min-h-11 items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <LoadingDots size="sm" label="Loading your keys" />
          Loading your keys…
        </div>
      )}
      {loadFailed && (
        <Banner inset tone="red">
          Couldn&rsquo;t load your keys.
        </Banner>
      )}

      {fresh && (
        <div className="space-y-2 rounded-lg bg-indigo-50 p-3 dark:bg-indigo-900/30">
          <p className="text-sm font-semibold">Copy this key now. It won&rsquo;t be shown again.</p>
          {/* break-all: the key has no space for a browser to break at. */}
          <p
            className="break-all rounded-md bg-white px-3 py-2 font-mono text-xs dark:bg-gray-900"
            data-testid="new-access-key"
          >
            {fresh.key}
          </p>
          <p className="break-words text-xs text-gray-600 dark:text-gray-300">
            To connect it as an MCP server, use{" "}
            <span className="font-mono">{origin}/api/mcp</span> with the header{" "}
            <span className="font-mono">Authorization: Bearer &lt;key&gt;</span>. Or read
            everything in one go from <span className="font-mono">/api/agent</span>.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" className="min-h-11 w-full sm:min-h-0 sm:w-auto" onClick={() => void copy(fresh.key)}>
              {copied ? "Copied" : "Copy key"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 w-full sm:min-h-0 sm:w-auto"
              onClick={() => setFresh(null)}
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {keys && keys.length > 0 && (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {keys.map((k) => (
            <li key={k.id} className="flex min-h-11 items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{k.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{accessKeyLine(k)}</p>
              </div>
              <Button
                type="button"
                variant="dangerOutline"
                className="min-h-11 sm:min-h-0"
                onClick={() => setRevoking(k)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      {keys && (
        <>
          <Checkbox
            rowTarget
            label={CAN_WRITE_LABEL}
            checked={canWrite}
            onChange={(e) => setCanWrite(e.target.checked)}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label="Name for a new key"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Jarvis"
                maxLength={40}
              />
            </div>
            <Button
              type="button"
              className="min-h-11 w-full sm:min-h-0 sm:w-auto"
              disabled={!name.trim()}
              loading={creating}
              onClick={() => void create()}
            >
              Create key
            </Button>
          </div>
          {error && (
            <Banner inset tone="red">
              {error}
            </Banner>
          )}
        </>
      )}

      <Modal
        open={revoking !== null}
        onClose={closeRevoke}
        title={`Revoke "${revoking?.name ?? ""}"?`}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={closeRevoke} disabled={revokeBusy}>
              Close
            </Button>
            <Button type="button" variant="danger" onClick={() => void revoke()} loading={revokeBusy}>
              Revoke
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Anything using this key stops working straight away. You can make a
            new one afterwards.
          </p>
          {revokeError && (
            <Banner inset tone="red">
              {revokeError}
            </Banner>
          )}
        </div>
      </Modal>
    </Card>
  );
}
