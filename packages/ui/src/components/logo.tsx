import { getBrand } from "../brand.js";

/** Brand mark — runtime-served by the api-server at `/api/brand/icon.svg`,
 *  driven by Helm `brand.icon` (defaults to the bundled SVG when unset).
 *  The alt text comes from the same brand fetch as the rest of the page. */
export function Logo({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src="/api/brand/icon.svg"
      alt={`${getBrand().name} logo`}
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  );
}
