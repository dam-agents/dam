export interface NamedConnection {
  name: string;
  accountLabel?: string;
}

export const connectionLabel = ({ name, accountLabel }: NamedConnection) =>
  accountLabel ? `${name} as ${accountLabel}` : name;
