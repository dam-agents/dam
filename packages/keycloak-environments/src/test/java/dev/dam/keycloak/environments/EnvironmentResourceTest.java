// TEST_OVERVIEW: An RFC 8707 `resource` becomes an access token's audience only when it is exactly the address of one Environment endpoint of this install: its scheme, one DNS label under its environments domain, its port, and nothing else. Every look-alike is refused, so a token can never name another site, the platform's own API or two Environments.
package dev.dam.keycloak.environments;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class EnvironmentResourceTest {
  private final EnvironmentResource https = new EnvironmentResource("https", "env.example.com", -1);
  private final EnvironmentResource local = new EnvironmentResource("http", "env.localhost", 4444);

  // TEST_SCENARIO: an endpoint's address as the gate's metadata names it is accepted unchanged, on an install with a default port and on one with its own; with the one trailing slash a URL parser adds, as the MCP SDK sends it, it is the same address, without the slash.
  @Test
  void acceptsAnEndpointAddress() {
    assertEquals(Optional.of("https://mcp-pr42-abc123.env.example.com"), https.accept("https://mcp-pr42-abc123.env.example.com"));
    assertEquals(Optional.of("https://mcp-pr42-abc123.env.example.com"), https.accept("https://mcp-pr42-abc123.env.example.com/"));
    assertEquals(Optional.of("http://app-x-1.env.localhost:4444"), local.accept("http://app-x-1.env.localhost:4444"));
  }

  // TEST_SCENARIO: #6318 — look-alike hosts and every other shape are refused: another site that ends with the domain, the domain under another site, a second label, a path, a query, a fragment, userinfo, another scheme or port, upper case, a trailing slash, and the bare domain.
  @Test
  void refusesEverythingElse() {
    List<String> refused = List.of(
        "https://evil.example/x.env.example.com",
        "https://x.env.example.com.evil.example",
        "https://a.b.env.example.com",
        "https://mcp-pr42.env.example.com/mcp",
        "https://mcp-pr42.env.example.com//",
        "https://mcp-pr42.env.example.com?x=1",
        "https://mcp-pr42.env.example.com#x",
        "https://user@mcp-pr42.env.example.com",
        "http://mcp-pr42.env.example.com",
        "https://mcp-pr42.env.example.com:8443",
        "https://MCP-pr42.env.example.com",
        "https://env.example.com",
        "https://.env.example.com",
        "https://-x.env.example.com",
        "https://xenv.example.com",
        "platform-api",
        "urn:client:platform-api",
        "",
        "https://mcp-pr42.env.example.com:443");
    for (String value : refused) assertTrue(https.accept(value).isEmpty(), value);
    assertTrue(local.accept("http://app-x.env.localhost").isEmpty());
    assertTrue(local.accept("http://app-x.env.localhost:4445").isEmpty());
  }
}
