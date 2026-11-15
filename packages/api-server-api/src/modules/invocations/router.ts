import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  operateAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  invocationAnswerInputSchema,
  invocationsQuestionsInputSchema,
  invocationStopInputSchema,
  invocationsKeptInputSchema,
  invocationTranscriptInputSchema,
  invocationsRunningInputSchema,
  invocationsTreeInputSchema,
} from "./schemas.js";

export const invocationsRouter = t.router({
  tree: readAgentProcedure
    .input(invocationsTreeInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.driverAgentId);
      return ctx.invocationsQuery.tree(input);
    }),
  kept: readAgentProcedure
    .input(invocationsKeptInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.driverAgentId);
      return ctx.invocationsQuery.kept(input);
    }),
  running: readAgentProcedure
    .input(invocationsRunningInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.driverAgentId);
      return ctx.invocationsQuery.running(input);
    }),
  transcript: readAgentProcedure
    .input(invocationTranscriptInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.driverAgentId);
      return ctx.invocationsQuery.transcript(input);
    }),
  questions: readAgentProcedure
    .input(invocationsQuestionsInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.driverAgentId);
      return ctx.invocationsQuery.questions(input);
    }),
  answer: operateAgentsProcedure
    .input(invocationAnswerInputSchema)
    .mutation(({ ctx, input }) => {
      checkAgentBinding(ctx, input.driverAgentId);
      return ctx.invocationsControl.answer(input);
    }),
  stop: operateAgentsProcedure
    .input(invocationStopInputSchema)
    .mutation(({ ctx, input }) => {
      checkAgentBinding(ctx, input.driverAgentId);
      return ctx.invocationsControl.stop(input);
    }),
});
