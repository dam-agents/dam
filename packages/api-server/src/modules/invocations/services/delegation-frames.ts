export interface TargetFrames {
  frames: string[];
  truncated: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: moves an Invocation target's conversation onto its
 * root driver's volume. Every call answers `null` or `false` when the pod it
 * needs does not answer — going down, already gone, or asleep — which is a
 * conversation simply not kept, never a failed reap. `storeOnRoot` answers
 * whether the root kept every frame, or `null` when it kept nothing.
 */
export interface DelegationFramesPort {
  readFromTarget(targetId: string): Promise<TargetFrames | null>;
  storeOnRoot(
    rootId: string,
    invocationId: string,
    frames: string[],
  ): Promise<{ truncated: boolean } | null>;
  readFromRoot(rootId: string, invocationId: string): Promise<string[] | null>;
}
