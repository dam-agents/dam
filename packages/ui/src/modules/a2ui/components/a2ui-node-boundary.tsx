import { Component, type ReactNode } from "react";

import { TextSkeleton } from "@/components/ui/text-skeleton";

interface Props {
  componentId: string;
  component: unknown;
  streaming: boolean;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class A2uiNodeBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.component !== this.props.component)
      this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.streaming) return <TextSkeleton width="60%" />;
    return (
      <span className="text-xs text-danger">
        Couldn&apos;t show “{this.props.componentId}”: {error.message}
      </span>
    );
  }
}
