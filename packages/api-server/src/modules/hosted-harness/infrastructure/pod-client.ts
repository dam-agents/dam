import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

export interface HostedPodClient {
  execRun(input: {
    command: string;
    timeoutMs?: number;
    cwd?: string;
  }): Promise<{
    exitCode: number | null;
    output: string;
    truncated: boolean;
    timedOut: boolean;
    cwd: string;
  }>;
  execStart(input: {
    command: string;
    cwd?: string;
  }): Promise<{ backgroundId: string }>;
  execTail(input: { backgroundId: string; offset?: number }): Promise<{
    output: string;
    nextOffset: number;
    running: boolean;
    exitCode: number | null;
  }>;
  execKill(backgroundId: string): Promise<{ killed: boolean }>;
  readFile(path: string): Promise<{ content: string }>;
  writeFile(path: string, content: string): Promise<void>;
  createFile(path: string, content: string): Promise<void>;
}

export function createHostedPodClient(
  agentId: string,
  namespace: string,
): HostedPodClient {
  const client = createTRPCClient<AppRouter>({
    links: [
      httpLink({ url: `http://${podBaseUrl(agentId, namespace)}/api/trpc` }),
    ],
  });
  return {
    execRun: (input) => client.exec.run.mutate(input),
    execStart: (input) => client.exec.start.mutate(input),
    execTail: (input) => client.exec.tail.query(input),
    execKill: (backgroundId) => client.exec.kill.mutate({ backgroundId }),
    readFile: async (path) => {
      const r = await client.files.read.query({ path });
      return { content: r.content };
    },
    writeFile: async (path, content) => {
      await client.files.write.mutate({ path, content });
    },
    createFile: async (path, content) => {
      await client.files.create.mutate({ path, content });
    },
  };
}
