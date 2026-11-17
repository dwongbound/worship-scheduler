"use client";
// /profile's last card: delete my account, for good. The confirmation is the
// point — it says plainly that this can't be undone, lists what goes with it,
// and the button stays disabled until DELETE is typed (lib/accountDeletion.ts;
// the server checks the same phrase). Closing changes nothing.
import { signOut } from "next-auth/react";
import { useState } from "react";
import Banner from "@/components/common/Banner";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import Modal from "@/components/common/Modal";
import { DELETE_CONFIRM_PHRASE, confirmationMatches } from "@/lib/accountDeletion";

export default function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (deleting) return;
    setOpen(false);
    setTyped("");
    setError(null);
  }

  async function deleteAccount() {
    setDeleting(true);
    setError(null);
    const res = await fetch("/api/me", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: typed }),
    });
    if (res.ok) {
      // The row is gone, so the session is a ghost already; this clears it.
      await signOut({ callbackUrl: "/" });
      return;
    }
    const body = await res.json().catch(() => ({}));
    setError(body.error ?? "Couldn't delete your account. Nothing was changed.");
    setDeleting(false);
  }

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">Delete account</h2>
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
        Permanently delete your TapWorship account and everything on it.
      </p>
      <Button type="button" variant="dangerOutline" onClick={() => setOpen(true)}>
        Delete account
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Delete your account permanently?"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={deleting}>
              Close
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={deleteAccount}
              disabled={!confirmationMatches(typed)}
              loading={deleting}
            >
              Delete my account forever
            </Button>
          </div>
        }
      >
        <div className="space-y-4" data-testid="delete-account-modal">
          <Banner inset tone="red">
            <strong>This can&rsquo;t be undone.</strong> There is no way to get
            your account back, and no one, admins included, can restore it.
          </Banner>
          <div className="text-sm text-gray-700 dark:text-gray-200">
            <p className="mb-2">Deleting your account removes, for good:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Your sign-in and profile</li>
              <li>Your place in every org and team</li>
              <li>Every set you&rsquo;re on, upcoming and past. Your seats on upcoming sets open up.</li>
              <li>Your availability, cover requests and swaps</li>
              <li>Any Google Calendar you connected for an org, which gets disconnected</li>
            </ul>
          </div>
          <Input
            label={`Type ${DELETE_CONFIRM_PHRASE} to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={deleting}
          />
          {error && (
            <Banner inset tone="red">
              {error}
            </Banner>
          )}
        </div>
      </Modal>
    </Card>
  );
}
