// Who a set's Slack group chat invites: the people on the set, plus the extra
// people on its recurring set (SetTemplateChatMember). Pure, so the rule is
// tested on its own; lib/slack.ts messageSetTeamOnSlack is its caller.

/** The set's people then the recurring set's extras, each once. */
export function groupChatUserIds(onSet: string[], extras: string[]): string[] {
  return [...new Set([...onSet, ...extras])];
}

/** Template `chatMemberIds` from a request body: a de-duped list of ids, or
 *  null when the field is absent (leave the list as it is) or malformed. */
export function parseChatMemberIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (!raw.every((v) => typeof v === "string" && v.length > 0)) return null;
  return [...new Set(raw as string[])];
}
