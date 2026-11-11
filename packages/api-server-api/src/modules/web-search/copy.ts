// UNIT_BOUNDARY_DESCRIPTION: how many more queries one allowed search request may run on the provider. The IBM LiteLLM proxy lets the model search again with queries it writes itself after reading the first results, up to its default of three searches per request, and reports only the first, so an approval covers the approved query and this many more.
export const WEB_SEARCH_FOLLOW_UP_QUERIES = 2;

export const WEB_SEARCH_HARNESSES_COVERED =
  "Claude Code, and any harness that searches through the Messages API, on an Anthropic key, the Claude subscription or IBM LiteLLM";

export const WEB_SEARCH_HARNESSES_NOT_COVERED =
  "Codex's built-in web search and search through Chat Completions";
