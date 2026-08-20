import { z } from "zod";

export const EXEC_TIMEOUT_DEFAULT_MS = 120_000;
export const EXEC_TIMEOUT_MAX_MS = 600_000;

export const execRunInputSchema = z.object({
  command: z.string().min(1).max(100_000),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().min(1_000).max(EXEC_TIMEOUT_MAX_MS).optional(),
});

export const execStartInputSchema = z.object({
  command: z.string().min(1).max(100_000),
  cwd: z.string().optional(),
});

export const execTailInputSchema = z.object({
  backgroundId: z.string().min(1),
  offset: z.number().int().min(0).optional(),
});

export const execKillInputSchema = z.object({
  backgroundId: z.string().min(1),
});
