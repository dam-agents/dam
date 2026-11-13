export type PullRequestState =
  | "draft"
  | "pending"
  | "approved"
  | "changes-requested"
  | "merged"
  | "closed";

export interface PullRequestLink {
  number: number;
  url: string;
  state?: PullRequestState;
  conflicts?: boolean;
}

export type CompareTo = "base" | "uncommitted";

export type FileChangeStatus = "added" | "deleted" | "modified" | "renamed";

export interface DiffStat {
  files: number;
  additions: number;
  deletions: number;
}

export interface ChangeSetRepository {
  id: string;
  name: string;
  root: string;
}

export interface ChangeSet {
  path: string;
  repository: ChangeSetRepository;
  branch: string | null;
  baseRef: string | null;
  stat: DiffStat;
  commitsAhead: number;
  uncommitted: boolean;
  pullRequest: PullRequestLink | null;
  sessionEditedAt: string | null;
  readError: string | null;
}

export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  uncommitted: boolean;
  patch: string | null;
}

export interface ChangeSetDiff {
  path: string;
  compare: CompareTo;
  baseRef: string | null;
  files: FileDiff[];
  truncated: boolean;
}
