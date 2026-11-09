package dev.dam.keycloak.environments;

import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.utils.KeycloakModelUtils;
import org.keycloak.models.utils.PostMigrationEvent;
import org.keycloak.services.scheduled.ClusterAwareScheduledTaskRunner;
import org.keycloak.timer.TimerProvider;

// UNIT_BOUNDARY_DESCRIPTION: schedules StaleClientsCleanup once a day, on one Keycloak node of the cluster, once the database is migrated.
final class RealmSetup {
  private static final long DAY_MS = 24L * 60 * 60 * 1000;

  private RealmSetup() { }

  static void register(String realm, KeycloakSessionFactory factory) {
    factory.register(event -> {
      if (!(event instanceof PostMigrationEvent)) return;
      KeycloakModelUtils.runJobInTransaction(factory, session -> {
        TimerProvider timer = session.getProvider(TimerProvider.class);
        timer.schedule(new ClusterAwareScheduledTaskRunner(factory, new StaleClientsCleanup(realm), DAY_MS), DAY_MS);
      });
    });
  }
}
