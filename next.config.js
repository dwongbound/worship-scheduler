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
};

module.exports = nextConfig;
