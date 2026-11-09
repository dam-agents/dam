package dev.dam.keycloak.access;

import org.keycloak.Config;
import org.keycloak.authentication.RequiredActionFactory;
import org.keycloak.authentication.RequiredActionProvider;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;

// UNIT_BOUNDARY_DESCRIPTION: registers AccessListRequiredAction with Keycloak, configured from the install's environment variables; AccessListSetup turns it on in the platform realm.
public class AccessListRequiredActionFactory implements RequiredActionFactory {
  public static final String ID = "dam-access-list";
  private AccessListConfig config;
  private AccessCheck check;

  @Override public RequiredActionProvider create(KeycloakSession session) { return new AccessListRequiredAction(config, check::check); }
  @Override public void init(Config.Scope scope) {
    config = AccessListConfig.fromEnvironment();
    check = AccessCheck.overHttp(config);
  }
  @Override public void postInit(KeycloakSessionFactory factory) { AccessListSetup.register(config, factory); }
  @Override public void close() { }
  @Override public String getId() { return ID; }
  @Override public String getDisplayText() { return "Platform access list"; }
}
