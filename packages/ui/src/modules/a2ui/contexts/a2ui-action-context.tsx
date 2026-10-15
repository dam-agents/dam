import { createContext, useContext } from "react";

type SendPrompt = (prompt: string) => Promise<void>;

const A2uiActionContext = createContext<SendPrompt | null>(null);

export const A2uiActionProvider = A2uiActionContext.Provider;

export function useA2uiSendPrompt(): SendPrompt | null {
  return useContext(A2uiActionContext);
}
