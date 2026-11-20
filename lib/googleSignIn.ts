// Remembers that someone signed in with Google (User.googleSignInAt), for the
// admin Team page's "Signed in with Google". Never blocks a sign-in: a failed
// write only means the label waits for their next one.
import { prisma } from "./prisma";

export async function recordGoogleSignIn(userId: string): Promise<void> {
  try {
    await prisma.user.update({ where: { id: userId }, data: { googleSignInAt: new Date() } });
  } catch (err) {
    console.error("[auth] couldn't record a Google sign-in", err);
  }
}
