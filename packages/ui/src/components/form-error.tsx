interface Props {
  message?: string;
}

export function FormError({ message }: Props) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}
