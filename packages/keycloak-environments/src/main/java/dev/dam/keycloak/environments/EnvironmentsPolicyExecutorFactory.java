package dev.dam.keycloak.environments;

import java.util.List;
import org.keycloak.Config;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.services.clientpolicy.executor.ClientPolicyExecutorProvider;
import org.keycloak.services.clientpolicy.executor.ClientPolicyExecutorProviderFactory;

// UNIT_BOUNDARY_DESCRIPTION: registers EnvironmentsPolicyExecutor with Keycloak's client policies, configured from the install's environment variables.
public class EnvironmentsPolicyExecutorFactory implements ClientPolicyExecutorProviderFactory {
  public static final String ID = "dam-environments";
  private EnvironmentsConfig config;

  @Override public ClientPolicyExecutorProvider create(KeycloakSession session) { return new EnvironmentsPolicyExecutor(config); }
  @Override public void init(Config.Scope scope) { config = EnvironmentsConfig.fromEnvironment(); }
  @Override public void postInit(KeycloakSessionFactory factory) { }
  @Override public void close() { }
  @Override public String getId() { return ID; }
  @Override public String getHelpText() { return "Keeps a sign-in for Environments to one Environment endpoint, with an offline session."; }
  @Override public List<ProviderConfigProperty> getConfigProperties() { return List.of(); }
}
