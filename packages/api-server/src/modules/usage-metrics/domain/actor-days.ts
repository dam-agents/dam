export interface ActorDayLedger {
  firstToday(actorSub: string, surface: string): boolean;
}

export function createActorDayLedger(deps: {
  now: () => number;
}): ActorDayLedger {
  let day = "";
  let seen = new Set<string>();

  return {
    firstToday(actorSub, surface) {
      const today = new Date(deps.now()).toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        seen = new Set<string>();
      }
      const key = `${surface}\0${actorSub}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  };
}
