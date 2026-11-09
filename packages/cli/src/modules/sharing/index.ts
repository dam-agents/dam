export {
  type Audience,
  audienceOf,
  isSlackDirectMessage,
  NO_GRANTS,
  type SharedGrants,
  sharedConnectionNames,
  sharedSlackChannels,
  sharingWarning,
} from "./domain/shared-access.js";
export {
  createSharingService,
  type SharingService,
} from "./services/sharing-service.js";
