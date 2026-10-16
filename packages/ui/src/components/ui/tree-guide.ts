export const TREE_GUIDE =
  "relative before:pointer-events-none before:absolute before:-top-px before:bottom-0 before:left-[calc(var(--tree-guide-x)-0.5px)] before:z-[1] before:w-px before:bg-border";

export const treeIndent = (depth: number) => 12 + depth * 22;

export const treeGuideX = (depth: number) => `${treeIndent(depth) + 8}px`;
