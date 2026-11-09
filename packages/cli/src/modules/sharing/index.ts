export {
  type Audience,
  audienceOf,
  NO_GRANTS,
  type SharedGrants,
  sharedConnectionNames,
  sharingUnchecked,
  sharingWarning,
} from "./domain/shared-access.js";
export {
  createSharingService,
  type SharingService,
} from "./services/sharing-service.js";
