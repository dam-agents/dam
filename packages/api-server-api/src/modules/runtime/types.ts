import { helloInput, helloResult } from "agent-runtime-api";
import type { HelloInput, HelloResult } from "agent-runtime-api";

export { helloInput, helloResult };
export type { HelloInput, HelloResult };

export interface RuntimeDeliveryService {
  hello(agentId: string, input: HelloInput): Promise<HelloResult>;
}
