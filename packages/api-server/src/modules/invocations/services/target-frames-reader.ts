export interface TargetFrames {
  frames: string[];
  truncated: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: reads an Invocation target's conversation out of
 * its pod while the pod is still up. `null` means the pod could not answer —
 * it is going down, or already gone — which is a target whose conversation is
 * simply not kept, never a failed reap.
 */
export interface TargetFramesReader {
  read(agentId: string): Promise<TargetFrames | null>;
}
