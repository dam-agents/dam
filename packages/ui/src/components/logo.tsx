/**
 * Dam brand mark — matches public/favicon.svg.
 */
export function Logo({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src="/favicon.svg"
      alt="Dam logo"
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  );
}
