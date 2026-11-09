package dev.dam.keycloak.access;

import org.jboss.logging.Logger;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.RealmModel;
import org.keycloak.models.RequiredActionProviderModel;
import org.keycloak.models.utils.KeycloakModelUtils;
import org.keycloak.models.utils.PostMigrationEvent;

/*
 * UNIT_BOUNDARY_DESCRIPTION: Turns the access-list required action on in the
 * platform realm at every start, once the database is migrated, and again
 * when the realm is first created, so no realm import or admin step is needed
 * and a Keycloak started on an empty database checks the list from its first
 * sign-in. An install without a check URL leaves the action off.
 */
final class AccessListSetup {
  private static final Logger LOG = Logger.getLogger(AccessListSetup.class);

  private AccessListSetup() { }

  static void register(AccessListConfig config, KeycloakSessionFactory factory) {
    factory.register(event -> {
      if (event instanceof PostMigrationEvent) {
        KeycloakModelUtils.runJobInTransaction(factory, session -> {
          RealmModel realm = session.realms().getRealmByName(config.realm());
          if (realm != null) ensure(realm, config.enabled());
        });
      } else if (event instanceof RealmModel.RealmPostCreateEvent created
          && config.realm().equals(created.getCreatedRealm().getName())) {
        ensure(created.getCreatedRealm(), config.enabled());
      }
    });
  }

  static void ensure(RealmModel realm, boolean enabled) {
    RequiredActionProviderModel action = realm.getRequiredActionProviderByAlias(AccessListRequiredActionFactory.ID);
    if (action == null) {
      if (!enabled) return;
      action = new RequiredActionProviderModel();
      action.setAlias(AccessListRequiredActionFactory.ID);
      action.setProviderId(AccessListRequiredActionFactory.ID);
      action.setName("Platform access list");
      action.setEnabled(true);
      action.setDefaultAction(false);
      action.setPriority(Integer.MAX_VALUE);
      realm.addRequiredActionProvider(action);
      LOG.infof("dam-access: access list on in realm %s", realm.getName());
      return;
    }
    if (action.isEnabled() == enabled) return;
    action.setEnabled(enabled);
    realm.updateRequiredActionProvider(action);
    LOG.infof("dam-access: access list %s in realm %s", enabled ? "on" : "off", realm.getName());
  }
}
