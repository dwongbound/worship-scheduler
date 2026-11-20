// ios/use-env copies the two values a DEBUG build of the iOS app needs out of
// the web app's env file. The thing worth pinning is what it does NOT copy:
// the env file is full of secrets, and the file it writes ends up inside an
// Xcode build.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = join(process.cwd(), "ios", "use-env");
let root: string;

// A bare PATH: the script regenerates the Xcode project when xcodegen is
// installed, and a temp folder has no project to regenerate.
const run = (...args: string[]) =>
  execFileSync("bash", [join(root, "ios", "use-env"), ...args], {
    env: { ...process.env, PATH: "/usr/bin:/bin" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "use-env-"));
  mkdirSync(join(root, "ios", "Config"), { recursive: true });
  mkdirSync(join(root, "env"));
  cpSync(script, join(root, "ios", "use-env"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const written = () => readFileSync(join(root, "ios", "Config", "Local.xcconfig"), "utf8");

describe("ios/use-env", () => {
  it("copies the server URL and the Google client id, and nothing else", () => {
    writeFileSync(
      join(root, "env", "dev.env"),
      [
        'DATABASE_URL="postgresql://worship:hunter2@localhost:5432/worship"',
        "NEXTAUTH_SECRET=do-not-copy-me",
        'NEXTAUTH_URL="http://localhost:3000"  # local',
        "GOOGLE_CLIENT_SECRET=also-not-this",
        "GOOGLE_IOS_CLIENT_ID=123-abc.apps.googleusercontent.com",
      ].join("\n")
    );
    expect(run("dev")).toContain("http://localhost:3000");
    const out = written();
    // An xcconfig reads // as a comment, so the URL's slashes are split.
    expect(out).toContain("TAPWORSHIP_API_URL = http:/$()/localhost:3000");
    expect(out).toContain("GOOGLE_IOS_CLIENT_ID = 123-abc.apps.googleusercontent.com");
    for (const secret of ["hunter2", "do-not-copy-me", "also-not-this", "DATABASE_URL"]) {
      expect(out).not.toContain(secret);
    }
  });

  it("defaults to dev, and the last assignment wins", () => {
    writeFileSync(
      join(root, "env", "dev.env"),
      "NEXTAUTH_URL=http://localhost:3000\nNEXTAUTH_URL=http://localhost:3001\n"
    );
    run();
    expect(written()).toContain("http:/$()/localhost:3001");
    expect(written()).toContain("GOOGLE_IOS_CLIENT_ID = \n");
  });

  it("prod forgets it, so debug builds are back on production", () => {
    writeFileSync(join(root, "env", "dev.env"), "NEXTAUTH_URL=http://localhost:3000\n");
    run("dev");
    expect(run("prod")).toContain("tapworship.com");
    expect(existsSync(join(root, "ios", "Config", "Local.xcconfig"))).toBe(false);
  });

  it("refuses a missing env file or one with no URL, and writes nothing", () => {
    expect(() => run("staging")).toThrow();
    writeFileSync(join(root, "env", "dev.env"), "NEXTAUTH_SECRET=x\n");
    expect(() => run("dev")).toThrow();
    expect(existsSync(join(root, "ios", "Config", "Local.xcconfig"))).toBe(false);
  });
});
