package dev.dam.keycloak.environments;

import java.util.List;
import org.keycloak.Config;
import org.keycloak.component.ComponentModel;
import org.keycloak.component.ComponentValidationException;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.services.clientregistration.policy.AbstractClientRegistrationPolicyFactory;
import org.keycloak.services.clientregistration.policy.ClientRegistrationPolicy;
import org.keycloak.services.clientregistration.policy.impl.TrustedHostClientRegistrationPolicyFactory;

/*
 * UNIT_BOUNDARY_DESCRIPTION: Takes the place of Keycloak's own Trusted Hosts
 * registration policy, under its id and with a higher order, so the policy
 * Keycloak puts in every realm checks the install's callback list instead.
 * Keycloak's version compares the registering machine's address, a person's
 * laptop, and the callbacks' hosts, so it refuses an app's own scheme such as
 * `cursor:`; Keycloak refuses it with both its checks off, and a realm import
 * cannot remove the copy Keycloak creates. Replacing the provider holds for
 * every realm and every start, whatever order Keycloak runs its policies in,
 * so on an install that serves no Environments — no
 * `DAM_ENVIRONMENTS_URL_TEMPLATE`, which the chart sets only with
 * `environments.domain` — every other call goes to Keycloak's own factory and
 * a registration is judged exactly as it is without this extension.
 */
public class EnvironmentCallbacksPolicyFactory extends AbstractClientRegistrationPolicyFactory {
  public static final String ID = "trusted-hosts";
  private final TrustedHostClientRegistrationPolicyFactory stock = new TrustedHostClientRegistrationPolicyFactory();
  private EnvironmentsConfig config = EnvironmentsConfig.of("", List.of());

  @Override
  public void init(Config.Scope scope) {
    config = EnvironmentsConfig.fromEnvironment();
  }

  public void configure(EnvironmentsConfig config) {
    this.config = config;
  }

  @Override
  public ClientRegistrationPolicy create(KeycloakSession session, ComponentModel model) {
    if (config.resource().isEmpty()) return stock.create(session, model);
    return new EnvironmentCallbacksPolicy(config.callbacks());
  }

  @Override public String getId() { return ID; }
  @Override public int order() { return 100; }

  @Override
  public String getHelpText() {
    if (config.resource().isEmpty()) return stock.getHelpText();
    return "Allows only the callbacks the install lists for clients of Environments.";
  }

  @Override
  public List<ProviderConfigProperty> getConfigProperties() {
    if (config.resource().isEmpty()) return stock.getConfigProperties();
    return List.of();
  }

  @Override
  public void validateConfiguration(KeycloakSession session, RealmModel realm, ComponentModel model) throws ComponentValidationException {
    if (config.resource().isEmpty()) stock.validateConfiguration(session, realm, model);
  }
}
