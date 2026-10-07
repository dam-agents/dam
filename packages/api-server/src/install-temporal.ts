// UNIT_BOUNDARY_DESCRIPTION: Replaces the global Temporal with temporal-polyfill. The api-server image's Node ships a Temporal that cannot load any timezone, so every rrule occurrence search fails there. rrule-temporal reads globalThis.Temporal once, when its module loads, so this module must be the first import of the entry point.
import { installImplementation } from "temporal-polyfill/shim";

installImplementation();
