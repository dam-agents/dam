import type { BindErrorCopy } from "../../agents/components/bind/bind-flow.js";

export function callbackErrorCopy(code: string): BindErrorCopy {
  switch (code) {
    case "denied":
      return {
        title: "Login was cancelled",
        hint: "Send `/bind` in the chat to try again.",
        terminal: true,
      };
    case "expired":
      return {
        title: "This login link has expired",
        hint: "Send `/bind` in the chat to get a fresh link.",
        terminal: true,
      };
    default:
      return {
        title: "Login failed",
        hint: "Send `/bind` in the chat to try again.",
        terminal: true,
      };
  }
}

export function bindErrorCopy(code: string | undefined): BindErrorCopy {
  switch (code) {
    case "BAD_REQUEST":
      return {
        title: "This link is invalid or has expired",
        hint: "Send `/bind` in the chat to get a fresh link.",
        terminal: true,
      };
    case "CONFLICT":
      return {
        title: "This chat is already connected to another agent",
        hint: "Send `/unbind` in the chat first, then `/bind` again.",
        terminal: true,
      };
    case "NOT_FOUND":
      return {
        title: "That agent no longer exists",
        hint: "Pick a different agent.",
        terminal: false,
      };
    default:
      return {
        title: "Something went wrong",
        hint: "Try again — or send `/bind` in the chat for a fresh link.",
        terminal: false,
      };
  }
}
