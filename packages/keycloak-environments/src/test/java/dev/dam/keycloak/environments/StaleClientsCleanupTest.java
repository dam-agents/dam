// TEST_OVERVIEW: The daily cleanup counts a client as stale only when it carries the time it registered itself and that time is more than 30 days back; a client with no stamp, such as the platform's own, or with one it cannot read, is never deleted.
package dev.dam.keycloak.environments;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class StaleClientsCleanupTest {
  // TEST_SCENARIO: an old stamp is before the cutoff, a fresh one is not, and a missing or unreadable one never is.
  @Test
  void readsTheRegistrationStamp() {
    Instant cutoff = Instant.parse("2026-10-07T00:00:00Z");
    assertTrue(StaleClientsCleanup.registeredBefore("2026-09-01T00:00:00Z", cutoff));
    assertFalse(StaleClientsCleanup.registeredBefore("2026-10-20T00:00:00Z", cutoff));
    assertFalse(StaleClientsCleanup.registeredBefore(null, cutoff));
    assertFalse(StaleClientsCleanup.registeredBefore("yesterday", cutoff));
  }
}
