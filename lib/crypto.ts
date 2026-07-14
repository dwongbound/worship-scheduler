// AES-256-GCM encryption for secrets we must store in the db — currently the
// per-org Slack bot tokens (lib/slack, platform admin). The key is DERIVED from
// NEXTAUTH_SECRET (sha256 → 32 bytes) so there's no extra env var to manage;
// the tradeoff is that rotating NEXTAUTH_SECRET invalidates existing ciphertexts
// (a re-connect of Slack fixes it). Format: base64(iv).base64(tag).base64(ct).
import crypto from "crypto";

function key(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required to encrypt/decrypt stored secrets");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

/** Encrypt a plaintext secret for at-rest storage. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString("base64")).join(".");
}

/** Decrypt a value produced by encryptSecret. Throws if tampered/wrong key. */
export function decryptSecret(blob: string): string {
  const [ivB, tagB, ctB] = blob.split(".");
  if (!ivB || !tagB || !ctB) throw new Error("malformed ciphertext");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
