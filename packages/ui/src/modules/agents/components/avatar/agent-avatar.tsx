import { useAgentAvatars } from "../../hooks/use-agent-avatars.js";
import { RobotHead } from "./robot-head.js";

interface Props {
  name: string;
  size?: number;
  className?: string;
}

export function AgentAvatar({ name, size, className }: Props) {
  const enabled = useAgentAvatars();
  if (!enabled) return null;
  return <RobotHead seed={name} size={size} className={className} />;
}
