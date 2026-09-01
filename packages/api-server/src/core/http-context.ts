import type { UserIdentity } from "api-server-api";

export type ApiVariables = {
  user: UserIdentity;
  roles: string[];
  surface: string;
};
