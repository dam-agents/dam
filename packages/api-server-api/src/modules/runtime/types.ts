import type {
  EventReportInput,
  HelloInput,
  HelloResult,
} from "agent-runtime-api";

export interface RuntimeDeliveryService {
  hello(agentId: string, input: HelloInput): Promise<HelloResult>;
  reportEvent(agentId: string, input: EventReportInput): Promise<void>;
}
