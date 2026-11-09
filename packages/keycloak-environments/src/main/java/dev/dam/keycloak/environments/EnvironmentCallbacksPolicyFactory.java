package dev.dam.keycloak.environments;

import java.util.List;
import org.keycloak.Config;
import org.keycloak.component.ComponentModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.services.clientregistration.policy.AbstractClientRegistrationPolicyFactory;
import org.keycloak.services.clientregistration.policy.ClientRegistrationPolicy;

/*
 * UNIT_BOUNDARY_DESCRIPTION: Takes the place of Keycloak's own Trusted Hosts
 * registration policy, under its id and with a higher order, so the policy
 * Keycloak puts in every realm checks the install's callback list instead.
 * Keycloak's version compares the registering machine's address, a person's
 * laptop, and the callbacks' hosts, so it refuses an app's own scheme such as
 * `cursor:`; Keycloak refuses it with both its checks off, and a realm import
 * cannot remove the copy Keycloak creates. Replacing the provider holds for
 * every realm and every start, whatever order Keycloak runs its policies in.
 */
public class EnvironmentCallbacksPolicyFactory extends AbstractClientRegistrationPolicyFactory {
  public static final String ID = "trusted-hosts";
  private CallbackRule rule;

  @Override
  public void init(Config.Scope scope) {
    rule = EnvironmentsConfig.fromEnvironment().callbacks();
  }

  @Override public ClientRegistrationPolicy create(KeycloakSession session, ComponentModel model) { return new EnvironmentCallbacksPolicy(rule); }
  @Override public String getId() { return ID; }
  @Override public int order() { return 100; }
  @Override public String getHelpText() { return "Allows only the callbacks the install lists for clients of Environments."; }
  @Override public List<ProviderConfigProperty> getConfigProperties() { return List.of(); }
}
