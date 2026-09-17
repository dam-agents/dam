import { t } from "../../trpc.js";
import {
  operateAgentsProcedure,
  readAgentProcedure,
  serveSatellitesProcedure,
} from "../../auth-procedures.js";
import {
  claimInputSchema,
  heartbeatInputSchema,
  jobRefSchema,
  reportInputSchema,
  satelliteConnectInputSchema,
  satelliteGrantInputSchema,
  satelliteNameSchema,
} from "./schemas.js";

export const satellitesRouter = t.router({
  list: readAgentProcedure.query(({ ctx }) => ctx.satellites.list()),

  jobs: readAgentProcedure
    .input(satelliteNameSchema)
    .query(({ ctx, input }) => ctx.satellites.listJobs(input)),

  grant: operateAgentsProcedure
    .input(satelliteGrantInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.satellites.grant(input.satellite, input.agentId),
    ),

  revoke: operateAgentsProcedure
    .input(satelliteGrantInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.satellites.revoke(input.satellite, input.agentId),
    ),

  remove: operateAgentsProcedure
    .input(satelliteNameSchema)
    .mutation(({ ctx, input }) => ctx.satellites.remove(input)),

  cancelJob: operateAgentsProcedure
    .input(jobRefSchema)
    .mutation(({ ctx, input }) =>
      ctx.satellites.cancelJob(input.satellite, input.job),
    ),

  connect: serveSatellitesProcedure
    .input(satelliteConnectInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.satelliteWorker.connect(ctx.user.sub, input.manifest, input.host),
    ),

  claim: serveSatellitesProcedure
    .input(claimInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.satelliteWorker.claim(ctx.user.sub, input),
    ),

  heartbeat: serveSatellitesProcedure
    .input(heartbeatInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.satelliteWorker.heartbeat(ctx.user.sub, input),
    ),

  report: serveSatellitesProcedure
    .input(reportInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.satelliteWorker.report(ctx.user.sub, input),
    ),

  drain: serveSatellitesProcedure
    .input(satelliteNameSchema)
    .mutation(({ ctx, input }) =>
      ctx.satelliteWorker.drain(ctx.user.sub, input),
    ),
});
