import { eventReportInput, helloInput, helloResult } from "agent-runtime-api";
import type {
  EventReportInput,
  HelloInput,
  HelloResult,
} from "agent-runtime-api";

export { eventReportInput, helloInput, helloResult };
export type { EventReportInput, HelloInput, HelloResult };

export interface RuntimeDeliveryService {
  hello(agentId: string, input: HelloInput): Promise<HelloResult>;
  reportEvent(agentId: string, input: EventReportInput): Promise<void>;
}
