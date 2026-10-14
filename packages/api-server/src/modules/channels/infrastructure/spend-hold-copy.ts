export type ChannelSpendHold = (
  agentId: string,
) => Promise<"limit" | "ceiling" | null>;

export function spendHoldUserCopy(
  reason: "limit" | "ceiling",
  agentName: string,
  brandName: string,
): string {
  return reason === "limit"
    ? `${agentName} reached its spend limit for today. Its owner can approve more in ${brandName}.`
    : `${agentName} reached its owner's spend ceiling for today. The owner can ask the platform operator for a higher one.`;
}
