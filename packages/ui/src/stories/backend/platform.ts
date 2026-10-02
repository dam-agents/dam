import type { createTRPCClient } from "@trpc/client";
import type { AppRouter } from "api-server-api";

import { answers, type Output } from "./trpc-server";

export type Platform = ReturnType<typeof createTRPCClient<AppRouter>>;

/** Typed fixture entry for an api-server procedure. */
export const at = answers<Platform>();

export type PlatformOutput<P extends string> = Output<Platform, P>;
