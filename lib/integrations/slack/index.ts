// Everything Slack-specific. The provider is chosen in lib/orgIntegration.ts;
// nothing outside this folder should need to know Slack's endpoints or markup.
// Slack-specific UI (the icon) belongs here too as it moves over.
export { SlackTransport } from "./transport";
export { SLACK_FORMAT } from "./format";
