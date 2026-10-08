import type { Pack } from "../data/packs.js";

export function PackIngredientSummary({ pack }: { pack: Pack }) {
  const included = pack.included.length;
  const required = pack.required.length;

  return (
    <p className="text-sm text-muted-foreground">
      {included} {included === 1 ? "component" : "components"} included
      {required > 0 && (
        <span className="text-muted-foreground/60">
          {" · "}
          {required} to set up
        </span>
      )}
    </p>
  );
}
