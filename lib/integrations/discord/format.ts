// Discord markdown. The only Discord file that exists yet — it's here ahead of
// the transport because it's pure, costs nothing to keep correct, and documents
// the one real formatting casualty: an ordinary Discord message cannot
// hyperlink, so a labelled link becomes label + bare URL.
//
// A DiscordTransport would join it in this folder, mirroring ../slack — as
// would anything else Discord-specific, an icon included.
import type { MessageFormat } from "../../messageFormat";

export const DISCORD_FORMAT: MessageFormat = {
  bold: (text) => `**${text}**`,
  link: (url, text) => `${text} (${url})`,
  // Discord rejects anything longer outright, so MessagingTransport chunks against it.
  maxChars: 2000,
};
