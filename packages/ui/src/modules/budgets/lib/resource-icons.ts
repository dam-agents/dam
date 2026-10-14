import { Chip, Meter, VmdkDisk } from "@carbon/icons-react";

// UNIT_BOUNDARY_DESCRIPTION: one icon per resource, shared by the resource card and the agent rows. Carbon has no memory-module icon, so memory takes the chip and CPU, whose row reads as congestion, the gauge.
export const RESOURCE_ICON = {
  memory: Chip,
  storage: VmdkDisk,
  cpu: Meter,
} as const;
