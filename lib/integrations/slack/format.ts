// Slack mrkdwn — what every message in this app was originally written in.
import type { MessageFormat } from "../../messageFormat";

export const SLACK_FORMAT: MessageFormat = {
  bold: (text) => `*${text}*`,
  italic: (text) => `_${text}_`,
  code: (text) => `\`${text}\``,
  link: (url, text) => `<${url}|${text}>`,
  // chat.postMessage's documented ceiling. Deliberately NOT Slack's recommended
  // 4000: chunking at 4000 would change messages that send fine today.
  maxChars: 40_000,
};
