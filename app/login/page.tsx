"use client";
// Auth screen: sign in (credentials), sign up (name/email/password), and
// optional Google SSO. Google only appears when it's configured on the
// server (checked via getProviders).
import { getProviders, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [slackAvailable, setSlackAvailable] = useState(false);
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

  useEffect(() => {
    getProviders().then((providers) => {
      setGoogleAvailable(!!providers?.google);
      setSlackAvailable(!!providers?.slack);
    });
  }, []);

  function switchMode(next: "signin" | "signup") {
    setMode(next);
    setError("");
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
      router.push("/calendar");
      router.refresh();
    }
  }

  async function onSignUp(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName, lastName, email, password: signupPassword }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
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
      router.push("/calendar");
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

        {(googleAvailable || slackAvailable) && (
          <>
            <div className="space-y-2">
              {googleAvailable && (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => signIn("google", { callbackUrl: "/calendar" })}
                >
                  Continue with Google
                </Button>
              )}
              {slackAvailable && (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => signIn("slack", { callbackUrl: "/calendar" })}
                >
                  Continue with Slack
                </Button>
              )}
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
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Creating account…" : "Sign up"}
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
      </Card>
    </div>
  );
}
