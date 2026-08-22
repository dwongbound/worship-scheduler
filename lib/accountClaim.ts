// Claiming a placeholder account.
//
// An admin import (the availability form roster — prisma/importFormResponses.ts)
// creates User rows for people who have never signed in, so their org
// membership and availability can be entered before they have an account.
// Those rows carry `isPlaceholder` and no usable password.
//
// EMAIL is what links the placeholder to the real person. When someone signs in
// with Google or signs up with an address that already has a placeholder row,
// we claim that row — keep its id, and with it every assignment, unavailability
// block and history event already recorded against them — instead of creating a
// second account that would strand all of it.
import { prisma } from "./prisma";

/**
 * Look a user up by email, ignoring case. People capitalise inconsistently
 * between a form response and a Google account, and an exact match would miss
 * the placeholder and silently create a duplicate — the one failure this whole
 * mechanism exists to prevent.
 */
export async function findUserByEmail(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" } },
  });
}

/**
 * Turn a claimed placeholder into an ordinary account: clear the flag and give
 * it whatever the person just proved they own — a password (signup) or nothing
 * at all (Google, which authenticates without one).
 *
 * The row's id, org memberships and availability are all left exactly as
 * imported; that continuity is the entire point of a placeholder.
 */
export async function claimPlaceholder(
  userId: string,
  fields: { passwordHash?: string; name?: string } = {}
) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      isPlaceholder: false,
      // Only overwrite the imported name when a better one is offered, so a
      // claim never blanks out the name an admin typed in.
      ...(fields.name ? { name: fields.name } : {}),
      ...(fields.passwordHash ? { passwordHash: fields.passwordHash } : {}),
    },
  });
}
