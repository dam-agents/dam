package dev.dam.keycloak.environments;

import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.utils.PostMigrationEvent;
import org.keycloak.provider.ProviderEvent;
import org.keycloak.services.scheduled.ClusterAwareScheduledTaskRunner;
import org.keycloak.timer.TimerProvider;

// UNIT_BOUNDARY_DESCRIPTION: schedules StaleClientsCleanup once a day, on one Keycloak node of the cluster, once the database is migrated.
public final class StaleClientsCleanupFactory {
  private static final long DAY_MS = 24L * 60 * 60 * 1000;

  private StaleClientsCleanupFactory() { }

  static void schedule(String realm, KeycloakSessionFactory factory) {
    factory.register((ProviderEvent event) -> {
      if (!(event instanceof PostMigrationEvent)) return;
      org.keycloak.models.utils.KeycloakModelUtils.runJobInTransaction(factory, session -> {
        TimerProvider timer = session.getProvider(TimerProvider.class);
        StaleClientsCleanup task = new StaleClientsCleanup(realm);
        timer.schedule(new ClusterAwareScheduledTaskRunner(factory, task, DAY_MS), DAY_MS);
      });
    });
  }
}
