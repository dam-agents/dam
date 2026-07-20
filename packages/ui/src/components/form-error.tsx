interface Props {
  message?: string;
}

export function FormError({ message }: Props) {
  if (!message) return null;
  return <p className="text-[14px] text-destructive">{message}</p>;
}
