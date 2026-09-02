type GlobToken =
  | { readonly kind: "lit"; readonly ch: string }
  | { readonly kind: "one" }
  | { readonly kind: "seg" }
  | { readonly kind: "anyseg" }
  | { readonly kind: "any" };

export function globToMatcher(glob: string): (path: string) => boolean {
  const toks: GlobToken[] = [];
  let i = 0;
  while (i < glob.length) {
    const char = glob[i]!;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        while (glob[i] === "*") i += 1;
        if (glob[i] === "/") {
          i += 1;
          toks.push({ kind: "anyseg" });
        } else {
          toks.push({ kind: "any" });
        }
      } else {
        i += 1;
        toks.push({ kind: "seg" });
      }
    } else if (char === "?") {
      i += 1;
      toks.push({ kind: "one" });
    } else {
      i += 1;
      toks.push({ kind: "lit", ch: char });
    }
  }
  const n = toks.length;
  return (path: string): boolean => {
    const m = path.length;
    const memo = new Map<number, boolean>();
    const solve = (ti: number, pj: number): boolean => {
      if (ti === n) return pj === m;
      const key = ti * (m + 1) + pj;
      const cached = memo.get(key);
      if (cached !== undefined) return cached;
      const tok = toks[ti]!;
      let res: boolean;
      if (tok.kind === "lit") {
        res = pj < m && path[pj] === tok.ch && solve(ti + 1, pj + 1);
      } else if (tok.kind === "one") {
        res = pj < m && path[pj] !== "/" && solve(ti + 1, pj + 1);
      } else if (tok.kind === "seg") {
        res =
          solve(ti + 1, pj) ||
          (pj < m && path[pj] !== "/" && solve(ti, pj + 1));
      } else if (tok.kind === "anyseg") {
        const atBoundary = pj === 0 || path[pj - 1] === "/";
        res =
          (atBoundary && solve(ti + 1, pj)) || (pj < m && solve(ti, pj + 1));
      } else {
        res = solve(ti + 1, pj) || (pj < m && solve(ti, pj + 1));
      }
      memo.set(key, res);
      return res;
    };
    return solve(0, 0);
  };
}
