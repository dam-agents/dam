package dev.dam.keycloak.environments;

import java.time.Duration;
import java.time.Instant;
import org.jboss.logging.Logger;
import org.keycloak.models.ClientModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.timer.ScheduledTask;

/*
 * UNIT_BOUNDARY_DESCRIPTION: The daily task that deletes clients that
 * registered themselves anonymously, are older than 30 days, and hold no
 * session and no offline session, so the realm's cap on such clients is not
 * filled by clients nobody uses any more. A client registered anonymously is
 * the one Keycloak marks with its registration access token and no creator;
 * the platform's own clients come from the realm import and are never
 * touched.
 */
public class StaleClientsCleanup implements ScheduledTask {
  public static final String TASK = "dam-environments-stale-clients";
  public static final String REGISTERED_AT = "dam.registered-at";
  private static final Logger LOG = Logger.getLogger(StaleClientsCleanup.class);
  static final Duration KEEP = Duration.ofDays(30);

  private final String realmName;

  public StaleClientsCleanup(String realmName) {
    this.realmName = realmName;
  }

  @Override
  public void run(KeycloakSession session) {
    RealmModel realm = session.realms().getRealmByName(realmName);
    if (realm == null) return;
    Instant cutoff = Instant.now().minus(KEEP);
    var stale = session.clients().searchClientsByAttributes(realm, java.util.Map.of(), null, null)
        .filter(c -> isStale(c, cutoff, session, realm))
        .map(ClientModel::getId)
        .toList();
    for (String id : stale) session.clients().removeClient(realm, id);
    if (!stale.isEmpty()) LOG.infof("deleted %d stale clients of Environments", stale.size());
  }

  @Override
  public String getTaskName() {
    return TASK;
  }

  static boolean registeredBefore(String registeredAt, Instant cutoff) {
    if (registeredAt == null) return false;
    try {
      return Instant.parse(registeredAt).isBefore(cutoff);
    } catch (RuntimeException e) {
      return false;
    }
  }

  private static boolean isStale(ClientModel client, Instant cutoff, KeycloakSession session, RealmModel realm) {
    if (!registeredBefore(client.getAttribute(REGISTERED_AT), cutoff)) return false;
    return session.sessions().getActiveUserSessions(realm, client) == 0
        && session.sessions().getOfflineSessionsCount(realm, client) == 0;
  }
}
