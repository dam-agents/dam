package dev.dam.keycloak.environments;

import java.util.List;
import org.keycloak.Config;
import org.keycloak.component.ComponentModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.services.clientregistration.policy.AbstractClientRegistrationPolicyFactory;
import org.keycloak.services.clientregistration.policy.ClientRegistrationPolicy;

// UNIT_BOUNDARY_DESCRIPTION: registers EnvironmentCallbacksPolicy as a client registration policy, with the install's callback list.
public class EnvironmentCallbacksPolicyFactory extends AbstractClientRegistrationPolicyFactory {
  public static final String ID = "dam-environment-callbacks";
  private CallbackRule rule;

  @Override
  public void init(Config.Scope scope) {
    rule = EnvironmentsConfig.fromEnvironment().callbacks();
  }

  @Override public ClientRegistrationPolicy create(KeycloakSession session, ComponentModel model) { return new EnvironmentCallbacksPolicy(rule); }
  @Override public String getId() { return ID; }
  @Override public String getHelpText() { return "Allows only the callbacks the install lists for clients of Environments."; }
  @Override public List<ProviderConfigProperty> getConfigProperties() { return List.of(); }
}
