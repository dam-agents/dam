// TEST_OVERVIEW: A client that registers itself may name only the callbacks the install lists: a loopback address on any port and path, a listed https site under any path, or a listed app scheme. Anything else, a look-alike host included, is refused, so a sign-in code never leaves for a site the install did not name.
package dev.dam.keycloak.environments;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class CallbackRuleTest {
  private final CallbackRule rule = new CallbackRule(List.of(
      "http://localhost", "http://127.0.0.1", "http://[::1]",
      "https://claude.ai", "https://vscode.dev", "cursor:", "vscode:"));

  // TEST_SCENARIO: #6318 — the callbacks Claude Code, Claude's web app, VS Code and Cursor use pass.
  @Test
  void allowsListedCallbacks() {
    for (String ok : List.of(
        "http://localhost:33418/callback", "http://127.0.0.1:5000/", "http://[::1]:9/cb",
        "https://claude.ai/api/mcp/auth_callback", "https://vscode.dev/redirect",
        "cursor://anysphere.cursor-retrieval/oauth/callback", "vscode://vscode.github-authentication/did-authenticate"))
      assertTrue(rule.allows(ok), ok);
  }

  // TEST_SCENARIO: look-alikes and unlisted callbacks are refused: a site that only starts like a listed one, plain http to a non-loopback host, https to loopback, another port on a listed site, an unlisted app scheme, userinfo, a fragment and junk.
  @Test
  void refusesTheRest() {
    for (String bad : List.of(
        "https://claude.ai.evil.example/cb", "https://evil.example/https://claude.ai",
        "http://claude.ai/cb", "https://localhost:443/cb", "https://claude.ai:8443/cb",
        "windsurf://x/cb", "http://user@localhost:1/cb", "http://localhost:1/cb#x",
        "javascript:alert(1)", "", "not a url", "http://localhost.evil.example/cb"))
      assertFalse(rule.allows(bad), bad);
  }
}
