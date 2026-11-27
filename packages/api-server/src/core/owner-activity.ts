import type { Redis } from "ioredis";

const OWNER_ACTIVITY_KEY_PREFIX = "owner-activity:";
const OWNER_ACTIVITY_TTL_SECONDS = 120;

// UNIT_BOUNDARY_DESCRIPTION: whether an owner uses the web UI now. The UI touches the owner's key every 60 seconds while its tab is visible and was used in the last two minutes, and the key lives 120 seconds, so the owner counts as active for two to four minutes after the last input. A read that fails counts as not active, so a card still goes out.
export interface OwnerActivity {
  touch(ownerSub: string): Promise<void>;
  isActive(ownerSub: string): Promise<boolean>;
}

export function createOwnerActivity(redis: Redis): OwnerActivity {
  const keyOf = (ownerSub: string) => `${OWNER_ACTIVITY_KEY_PREFIX}${ownerSub}`;
  return {
    async touch(ownerSub) {
      await redis.set(keyOf(ownerSub), "1", "EX", OWNER_ACTIVITY_TTL_SECONDS);
    },
    async isActive(ownerSub) {
      try {
        return (await redis.exists(keyOf(ownerSub))) === 1;
      } catch {
        return false;
      }
    },
  };
}
