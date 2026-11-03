import { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import type { Db } from "db";
import { events$, EventType, ofType, type AgentCreated } from "../../events.js";
import type { K8sClient } from "../agents/infrastructure/k8s.js";
import { createEgressRulesRepository } from "../egress-rules/infrastructure/egress-rules-repository.js";
import { createAgentKeyCodec } from "./domain/agent-key.js";
import { createAgentKeySecretPort } from "./infrastructure/agent-key-secret-port.js";
import { createAgentKeysRepository } from "./infrastructure/agent-keys-repository.js";
import {
  createAgentAccess,
  type AgentAccess,
} from "./services/agent-access.js";

// UNIT_BOUNDARY_DESCRIPTION: an Agent the cluster holds, as the issue pass reads it: its id, owner, and the Agent it is an Environment of, if any.
export interface KeyedAgent {
  id: string;
  owner: string;
  environmentOf?: string;
}

export interface ComposeAgentKeysDeps {
  db: Db;
  k8s: K8sClient;
  hmacKey: string;
  domain: string | null;
  port: number | null;
  listAgents: () => Promise<KeyedAgent[]>;
  identityOf: (
    agentId: string,
  ) => Promise<{ owner: string; environmentOf?: string } | null>;
  log: (message: string) => void;
}

export interface AgentKeysComposition {
  access: AgentAccess;
  // UNIT_BOUNDARY_DESCRIPTION: gives every ordinary Agent that never held the rule the rule and its key, and a key to every Agent whose rule is active but whose key is missing; run at startup and periodically, so an Agent created while the api-server was down, or one from before this feature, is caught up.
  issueAll: () => Promise<number>;
  startSaga: () => Subscription;
  cleanupSource: {
    name: string;
    listAgentIds: () => Promise<string[]>;
    cleanup: (agentId: string) => Promise<void>;
  };
}

const ISSUE_CONCURRENCY = 4;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Wires Agent access to Environments once per
 * install. A new Agent gets the platform's Environments rule and its key when
 * it is created; an Environment never does, since an Environment is never a
 * visitor. Deleting an Agent deletes its key and its Secret.
 */
export function composeAgentKeys(
  deps: ComposeAgentKeysDeps,
): AgentKeysComposition {
  const keys = createAgentKeysRepository(deps.db);
  const secrets = createAgentKeySecretPort(deps.k8s);
  const rules = createEgressRulesRepository(deps.db);
  const access = createAgentAccess({
    domain: deps.domain,
    port: deps.port,
    codec: createAgentKeyCodec(deps.hmacKey),
    keys,
    secrets,
    rules,
  });

  async function issueFor(agentId: string, owner: string) {
    try {
      await access.issue(agentId, owner);
    } catch (err) {
      deps.log(
        `could not give ${agentId} its Environments access: ${String(err)}`,
      );
    }
  }

  return {
    access,

    async issueAll() {
      if (deps.domain === null) return 0;
      let issued = 0;
      for (const agent of await deps.listAgents()) {
        if (agent.environmentOf) continue;
        await issueFor(agent.id, agent.owner);
        issued += 1;
      }
      return issued;
    },

    startSaga() {
      const sub = new Subscription();
      if (deps.domain === null) return sub;
      sub.add(
        events$()
          .pipe(
            ofType<AgentCreated>(EventType.AgentCreated),
            mergeMap(async (event) => {
              const identity = await deps
                .identityOf(event.agentId)
                .catch(() => null);
              if (!identity || identity.environmentOf) return;
              await issueFor(event.agentId, event.ownerSub);
            }, ISSUE_CONCURRENCY),
          )
          .subscribe(),
      );
      return sub;
    },

    cleanupSource: {
      name: "agent-keys",
      listAgentIds: async () => {
        const ids = new Set(await keys.listAgentIds());
        for (const id of await secrets.listAgentIds()) ids.add(id);
        return [...ids];
      },
      cleanup: (agentId) => access.forget(agentId),
    },
  };
}
