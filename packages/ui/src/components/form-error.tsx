interface Props {
  message?: string;
}

export function FormError({ message }: Props) {
  if (!message) return null;
  return <p className="text-[13px] text-destructive">{message}</p>;
}
