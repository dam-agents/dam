interface Props {
  message?: string;
}

export function FormError({ message }: Props) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  );
}
