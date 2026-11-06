// TEST_OVERVIEW: A sign-in for Environments names exactly one Environment endpoint as its resource and asks for an offline session, or Keycloak refuses it; a later code exchange or refresh may repeat the same resource but never name another. Sign-ins that do not ask for the environments scope, such as the platform's own app, are left alone.
package dev.dam.keycloak.environments;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.keycloak.services.clientpolicy.ClientPolicyException;

class EnvironmentsPolicyExecutorTest {
  private static final String ENV = "https://mcp-pr42-abc123.env.example.com";
  private final EnvironmentsPolicyExecutor executor = new EnvironmentsPolicyExecutor(
      EnvironmentsConfig.of("https://{host}.env.example.com", List.of()));

  // TEST_SCENARIO: a sign-in with the environments scope, one Environment as its resource and offline_access passes.
  @Test
  void passesAGoodSignIn() {
    assertDoesNotThrow(() -> executor.checkSignIn("openid environments offline_access", List.of(ENV)));
  }

  // TEST_SCENARIO: #6318 — a sign-in for Environments with no resource, two, or one that is not an Environment endpoint is refused with invalid_target; one without offline_access with invalid_scope, since only an offline session keeps two sign-ins of one client apart.
  @Test
  void refusesABadSignIn() {
    assertEquals("invalid_target", refused(() -> executor.checkSignIn("environments offline_access", null)));
    assertEquals("invalid_target", refused(() -> executor.checkSignIn("environments offline_access", List.of(ENV, ENV))));
    assertEquals("invalid_target", refused(() -> executor.checkSignIn("environments offline_access", List.of("platform-api"))));
    assertEquals("invalid_target", refused(() -> executor.checkSignIn("environments offline_access", List.of(ENV + "/mcp"))));
    assertEquals("invalid_scope", refused(() -> executor.checkSignIn("openid environments", List.of(ENV))));
  }

  // TEST_SCENARIO: a sign-in that does not ask for the environments scope is not this executor's to judge, whatever it sends.
  @Test
  void leavesOtherSignInsAlone() {
    assertDoesNotThrow(() -> executor.checkSignIn("openid profile", null));
    assertDoesNotThrow(() -> executor.checkSignIn("openid", List.of("anything")));
  }

  // TEST_SCENARIO: a code exchange or refresh may omit the resource or repeat it, and is refused when it names another.
  @Test
  void keepsTheSignedInResource() {
    assertDoesNotThrow(() -> executor.checkSameResource(ENV, null));
    assertDoesNotThrow(() -> executor.checkSameResource(ENV, List.of(ENV)));
    assertDoesNotThrow(() -> executor.checkSameResource(ENV + "/", List.of(ENV)));
    assertDoesNotThrow(() -> executor.checkSameResource(ENV, List.of(ENV + "/")));
    assertDoesNotThrow(() -> executor.checkSameResource(null, List.of("x")));
    assertEquals("invalid_target", refused(() -> executor.checkSameResource(ENV, List.of("https://mcp-other.env.example.com"))));
    assertEquals("invalid_target", refused(() -> executor.checkSameResource(ENV, List.of(ENV, "x"))));
  }

  private interface Check { void run() throws ClientPolicyException; }

  private static String refused(Check check) {
    return assertThrows(ClientPolicyException.class, check::run).getError();
  }
}
