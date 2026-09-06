"use client";
// Auth screen: sign in (credentials), sign up (name/email/password), and
// optional Google SSO. Google only appears when it's configured on the
// server (checked via getProviders).
//
// One extra gate on the way in: if the name being registered already belongs
// to an account, we interrupt with a popup naming it (see lib/nameConflict).
// Both providers land in the same dialog — signup gets its conflicts from a
// 409, Google from the ?nameConflict params its signIn callback redirects to.
import { getProviders, signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import Modal from "@/components/common/Modal";
import {
  type NameConflict,
  parseNameConflicts,
} from "@/lib/nameConflict";

// useSearchParams() (used inside LoginForm to read ?callbackUrl) must sit
// under a Suspense boundary, so the page export just wraps the form in one.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  // Where to go after a successful login. Middleware appends ?callbackUrl when
  // it bounces you here from a protected page; otherwise default to /calendar.
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/calendar";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Sign-in fields
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [password, setPassword] = useState("");

  // Sign-up fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupPassword2, setSignupPassword2] = useState("");
  // Revealed only when the server says this email already has a PLACEHOLDER
  // account waiting (one an admin imported from the availability form). Claiming
  // it needs the org key, since the placeholder is already inside the org and
  // would otherwise skip the /join gate. Ordinary signups never see this field.
  const [needsOrgKey, setNeedsOrgKey] = useState(false);
  const [orgKey, setOrgKey] = useState("");

  // The duplicate-name warning: which existing accounts we found, and which
  // provider was interrupted (that decides what "Continue anyway" has to do —
  // resubmit the signup, or re-run Google after recording consent server-side).
  // `googleEmail` is the address Google was signing in with, present only on
  // that path.
  const [conflicts, setConflicts] = useState<NameConflict[] | null>(null);
  const [googleEmail, setGoogleEmail] = useState("");

  useEffect(() => {
    getProviders().then((providers) => {
      setGoogleAvailable(!!providers?.google);
    });
  }, []);

  // Google's signIn callback bounced us back here with the accounts it found.
  // Show the same dialog the signup 409 shows, then strip the params so a
  // refresh (or a later visit) doesn't resurrect a stale warning.
  useEffect(() => {
    const email = searchParams.get("nameConflict");
    const found = parseNameConflicts(searchParams.get("conflicts"));
    if (!email || found.length === 0) return;
    setGoogleEmail(email);
    setConflicts(found);
    router.replace("/login");
  }, [searchParams, router]);

  function switchMode(next: "signin" | "signup") {
    setMode(next);
    setError("");
    setNeedsOrgKey(false);
    setOrgKey("");
    setConflicts(null);
  }

  // "That's me" — take them to the account we found instead of making a second
  // one. A real account is SIGNED IN to; an unclaimed roster row has no password
  // yet, so that one goes to signup with the address prefilled (which claims it).
  function useExistingAccount(conflict: NameConflict) {
    if (conflict.isPlaceholder) {
      switchMode("signup");
      setEmail(conflict.email);
    } else {
      switchMode("signin");
      setUsernameOrEmail(conflict.email);
    }
  }

  // "Not me, keep going." Credentials just resubmits with the override; Google
  // has no request body to carry one, so record consent in a cookie first and
  // re-run the provider (see /api/auth/allow-duplicate-name).
  async function continueAnyway() {
    const viaGoogle = !!googleEmail;
    setConflicts(null);
    if (!viaGoogle) {
      submitSignup(true);
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/auth/allow-duplicate-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: googleEmail }),
    });
    if (!res.ok) {
      setSubmitting(false);
      setError("Couldn't continue with Google — sign up with a password instead.");
      return;
    }
    signIn("google", { callbackUrl });
  }

  async function onSignIn(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    // redirect:false → we handle success/failure ourselves.
    const result = await signIn("credentials", {
      redirect: false,
      username: usernameOrEmail,
      password,
    });
    setSubmitting(false);
    if (result?.error) {
      setError("Invalid username or password.");
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
  }

  function onSignUp(e: FormEvent) {
    e.preventDefault();
    if (signupPassword !== signupPassword2) {
      setError("Passwords don't match.");
      return;
    }
    submitSignup(false);
  }

  // The signup POST itself, split out because the duplicate-name dialog's
  // "This is someone else" re-runs it with the override set.
  async function submitSignup(allowDuplicateName: boolean) {
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName,
        lastName,
        email,
        password: signupPassword,
        // Only meaningful when claiming a placeholder; ignored otherwise.
        orgKey: orgKey.trim() || undefined,
        // Only sent on the second pass, after they've seen the warning.
        allowDuplicateName: allowDuplicateName || undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // "There's already an account for you — prove you're in the org." Reveal
      // the key field and let them submit again with it filled in.
      if (data.needsOrgKey) setNeedsOrgKey(true);
      // Someone already serves under this name. Open the dialog instead of
      // showing the bare error — the useful part is WHICH account we found.
      if (Array.isArray(data.nameConflicts) && data.nameConflicts.length > 0) {
        setGoogleEmail("");
        setConflicts(data.nameConflicts);
        setSubmitting(false);
        return;
      }
      setError(data.error ?? "Could not create account.");
      setSubmitting(false);
      return;
    }
    // Auto sign-in with the brand-new credentials (email is the username).
    const result = await signIn("credentials", {
      redirect: false,
      username: email,
      password: signupPassword,
    });
    setSubmitting(false);
    if (result?.error) {
      setError("Account created — please sign in.");
      switchMode("signin");
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-xl font-bold text-indigo-600 dark:text-indigo-400">
          Worship Scheduler
        </h1>
        <p className="mb-6 text-center text-sm text-gray-500">
          {mode === "signin" ? "Sign in to your account" : "Create your account"}
        </p>

        {googleAvailable && (
          <>
            <div className="space-y-2">
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => signIn("google", { callbackUrl })}
              >
                Continue with Google
              </Button>
            </div>
            <div className="my-4 flex items-center gap-3 text-xs text-gray-400">
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
              or
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            </div>
          </>
        )}

        {mode === "signin" ? (
          <form onSubmit={onSignIn} className="space-y-4">
            <Input
              label="Username / Email"
              value={usernameOrEmail}
              onChange={(e) => setUsernameOrEmail(e.target.value)}
              autoComplete="username"
              required
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        ) : (
          <form onSubmit={onSignUp} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                required
              />
              <Input
                label="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                required
              />
            </div>
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <Input
              label="Password"
              type="password"
              value={signupPassword}
              onChange={(e) => setSignupPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <Input
              label="Confirm password"
              type="password"
              value={signupPassword2}
              onChange={(e) => setSignupPassword2(e.target.value)}
              autoComplete="new-password"
              required
            />
            {needsOrgKey && (
              <Input
                label="Organization key"
                value={orgKey}
                onChange={(e) => setOrgKey(e.target.value)}
                autoComplete="off"
                autoFocus
                required
              />
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting
                ? needsOrgKey
                  ? "Claiming account…"
                  : "Creating account…"
                : needsOrgKey
                  ? "Claim my account"
                  : "Sign up"}
            </Button>
          </form>
        )}

        <div className="mt-6 text-center text-sm text-gray-500">
          {mode === "signin" ? (
            <>
              Don&rsquo;t have an account?{" "}
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Sign in
              </button>
            </>
          )}
        </div>

        <VersionFooter />
      </Card>

      {/* Duplicate-name warning. Not a block — two people really can share a
          name — but the account we found is named in full so the far more
          likely case (same person, second address) is one click to fix. */}
      {conflicts && conflicts.length > 0 && (
        <Modal
          open
          onClose={() => setConflicts(null)}
          title={
            conflicts.length > 1
              ? "Accounts with this name already exist"
              : "An account with this name already exists"
          }
          footer={
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setConflicts(null)}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={continueAnyway} disabled={submitting}>
                {submitting ? "Continuing…" : "This is someone else — continue"}
              </Button>
            </>
          }
        >
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {googleEmail ? (
              <>
                You&rsquo;re signing in as{" "}
                <span className="font-medium">{googleEmail}</span>, but we
                already have{conflicts.length > 1 ? "" : " an account"} under
                that name:
              </>
            ) : (
              <>
                We already have{conflicts.length > 1 ? "" : " an account"} under
                that name:
              </>
            )}
          </p>

          <ul className="mt-3 space-y-2">
            {conflicts.map((c) => (
              <li
                key={c.email}
                className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
              >
                <p className="text-sm font-medium">{c.name}</p>
                <p className="break-all text-sm text-gray-500 dark:text-gray-400">
                  {c.email}
                </p>
                <button
                  type="button"
                  onClick={() => useExistingAccount(c)}
                  className="mt-2 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {c.isPlaceholder
                    ? "That's me — sign up with that email"
                    : "That's me — sign in with that email"}
                </button>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
            If that&rsquo;s you, use that email — otherwise your sets, roles and
            availability end up split across two accounts. If it&rsquo;s a
            different person who happens to share your name, continue: your org
            will simply have two people with the same name.
          </p>
        </Modal>
      )}
    </div>
  );
}

// Build stamp: app version + a link to the exact commit on GitHub. Both values
// are inlined at build time by next.config.js. The commit link is hidden when
// the sha is unknown (e.g. git unavailable in the build sandbox).
function VersionFooter() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  const sha = process.env.NEXT_PUBLIC_COMMIT_SHA;
  const repo = "https://github.com/dwongbound/worship-scheduler";

  return (
    <p className="mt-4 text-center text-xs text-gray-400">
      v{version}
      {sha && (
        <>
          {" · "}
          <a
            href={`${repo}/commit/${sha}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono hover:underline"
          >
            {sha.slice(0, 7)}
          </a>
        </>
      )}
    </p>
  );
}
