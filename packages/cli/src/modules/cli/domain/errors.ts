import type { ConfigKey } from "./config.js";

export interface MissingConfigError {
  kind: "missing-config";
  key: ConfigKey;
}

export interface MalformedConfigError {
  kind: "malformed-config";
  reason: string;
}

export interface InvalidKeyError {
  kind: "invalid-key";
  input: string;
  validKeys: readonly ConfigKey[];
}

export interface InvalidValueError {
  kind: "invalid-value";
  key: ConfigKey;
  input: string;
  reason: string;
}

export interface FileWriteError {
  kind: "file-write";
  path: string;
  reason: string;
}

export type ProbeErrorCode =
  | "network"
  | "timeout"
  | "non-ok-status"
  | "malformed-response";

export interface ProbeError {
  kind: "probe-error";
  code: ProbeErrorCode;
  message: string;
}

export type DomainError =
  | MissingConfigError
  | MalformedConfigError
  | InvalidKeyError
  | InvalidValueError
  | FileWriteError
  | ProbeError;
