import { nextUtcMidnight } from "api-server-api";

export type ChannelSpendHold = (
  agentId: string,
) => Promise<"limit" | "ceiling" | null>;

export function spendHoldUserCopy(
  reason: "limit" | "ceiling",
  agentName: string,
  brandName: string,
  resetAt: string,
): string {
  return reason === "limit"
    ? `${agentName} reached its spend limit for today, so it does not answer now. Its owner can continue it in ${brandName}; otherwise it answers again at ${resetAt}.`
    : `${agentName} reached its owner's spend ceiling for today, so it does not answer until ${resetAt}. The owner can ask the platform operator for a higher ceiling.`;
}

function resetUnixSeconds(now: Date): string {
  return String(Math.floor(nextUtcMidnight(now).getTime() / 1000));
}

export function slackResetTime(now: Date): string {
  return `<!date^${resetUnixSeconds(now)}^{time} on {date_short}|00:00 UTC>`;
}

export function telegramResetTime(now: Date): string {
  return `![00:00 UTC](tg://time?unix=${resetUnixSeconds(now)}&format=wt)`;
}
