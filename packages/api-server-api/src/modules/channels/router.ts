import { t } from "../../trpc.js";
import { readAgentProcedure } from "../../auth-procedures.js";

export const channelsRouter = t.router({
  available: readAgentProcedure.query(({ ctx }) => ctx.channels.available),

  telegramBot: readAgentProcedure.query(({ ctx }) => {
    const username = ctx.channels.telegramBotUsername();
    return username ? { username } : null;
  }),
});
