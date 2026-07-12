/** @type {import('next').NextConfig} */
const { execSync } = require("node:child_process");
const pkg = require("./package.json");

// Resolve the current commit sha at build time. Vercel exposes it as an env
// var (git isn't in the build sandbox); locally we shell out to git. Falls
// back to "" so the UI can just hide the link when it's unknown.
function resolveCommitSha() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return "";
  }
}

const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_COMMIT_SHA: resolveCommitSha(),
  },
  // "/" → the Calendar tab, as a plain HTTP redirect. This used to be an RSC
  // redirect() in app/page.tsx, but that crashes production hydration with
  // React #310 inside Next's app-router when an AUTHENTICATED user lands on
  // "/" (e.g. right after an OAuth sign-in, whose default callback is "/") —
  // see vercel/next.js#63121. An HTTP redirect runs before any React does.
  async redirects() {
    return [{ source: "/", destination: "/calendar", permanent: false }];
  },
};

module.exports = nextConfig;
