import { createContext } from "react";

// UNIT_BOUNDARY_DESCRIPTION: the side panel shell tells the panels it hosts, and the X that closes them, whether the Unified right toolbar experiment draws the tile variant; a panel outside the shell, such as the classic chat's column, keeps the classic chrome.
export const RightToolbarTiles = createContext(false);
