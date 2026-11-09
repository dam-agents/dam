import type { AccessListService } from "api-server-api";
import { securityLog } from "../../../core/security-log.js";
import type { AccessListRepository } from "../infrastructure/access-list-repository.js";

export type AccessListForOperator = (operatorSub: string) => AccessListService;

// UNIT_BOUNDARY_DESCRIPTION: an operator's list, add and remove on the Access List. Every change is a security event naming the operator and the address, since it decides who may sign in to the install.
export function createAccessListAdmin(deps: {
  repo: AccessListRepository;
  enabled: boolean;
}): AccessListForOperator {
  const view = async () => ({
    enabled: deps.enabled,
    entries: await deps.repo.list(),
  });
  return (operatorSub) => ({
    list: view,
    async add({ emails }) {
      const added = await deps.repo.add(emails, operatorSub);
      securityLog("info", "access_list.add", {
        category: "authz-list",
        actor: operatorSub,
        actorKind: "user",
        result: "success",
        detail: { emails, added },
      });
      return view();
    },
    async remove({ email }) {
      const removed = await deps.repo.remove(email);
      securityLog("info", "access_list.remove", {
        category: "authz-list",
        actor: operatorSub,
        actorKind: "user",
        result: "success",
        target: email,
        detail: { removed },
      });
      return view();
    },
  });
}
