const paused = process.env.SENTINEL_PAUSED !== "false";
const hasCreds = Boolean(process.env.GITHUB_APP_ID && process.env.SLACK_BOT_TOKEN);

function sentinelStatus(): string {
  if (paused) return "PAUSED (set SENTINEL_PAUSED=false to enable)";
  if (!hasCreds) return "IDLE (waiting for GitHub App + Slack tokens)";
  return "ACTIVE";
}

console.log(`[sentinel] starting — ${sentinelStatus()}`);
setInterval(() => console.log(`[sentinel] heartbeat — ${sentinelStatus()}`), 60_000);
