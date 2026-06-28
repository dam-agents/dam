interface CardIconProps {
  provider: string;
  size?: "sm" | "md" | "lg";
}

const sizeMap = { sm: 16, md: 24, lg: 32 } as const;

export function CardIcon({ provider, size = "md" }: CardIconProps) {
  const px = sizeMap[size];
  return (
    <div
      className="rounded bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground uppercase shrink-0"
      style={{ width: px, height: px }}
    >
      {provider.charAt(0)}
    </div>
  );
}
