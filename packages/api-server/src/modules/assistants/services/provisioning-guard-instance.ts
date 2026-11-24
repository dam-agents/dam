import { createProvisioningGuard } from "./provisioning-guard.js";

/* UNIT_BOUNDARY_DESCRIPTION: the one guard a replica has, shared by every request context it composes — so a person opening several tabs at once makes one attempt per replica, not one per tab. */
const guard = createProvisioningGuard();

export const assistantProvisioningGuard = (): typeof guard => guard;
