// TEST_OVERVIEW: The extension holds Keycloak's trusted-hosts provider id in every realm, so on an install that serves no Environments it must change nothing about anonymous registration: the policy, its config properties, its help text and its configuration check are Keycloak's own. This test JVM sets no DAM_ENVIRONMENTS_URL_TEMPLATE, which is what an install without an Environments domain looks like to the extension.
package dev.dam.keycloak.environments;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.keycloak.component.ComponentModel;
import org.keycloak.component.ComponentValidationException;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.services.clientregistration.policy.impl.TrustedHostClientRegistrationPolicy;
import org.keycloak.services.clientregistration.policy.impl.TrustedHostClientRegistrationPolicyFactory;

class EnvironmentCallbacksPolicyFactoryStockModeTest {
  private final EnvironmentCallbacksPolicyFactory factory = new EnvironmentCallbacksPolicyFactory();

  // TEST_SCENARIO: U5 — the chart sets no DAM_ENVIRONMENTS_URL_TEMPLATE without an Environments domain, so the callback list is empty; an install that serves no Environments must judge a registration by Keycloak's own rules instead of refusing it against an empty list.
  @Test
  void judgesRegistrationByKeycloaksOwnPolicy() {
    factory.init(null);
    assertInstanceOf(TrustedHostClientRegistrationPolicy.class, factory.create(null, component(true, true)));
    assertEquals(stock().getHelpText(), factory.getHelpText());
    assertEquals(propertyNames(stock().getConfigProperties()), propertyNames(factory.getConfigProperties()));
  }

  // TEST_SCENARIO: the realm component's own trusted-hosts config is checked by Keycloak's rules, so Keycloak's refusal of a component with both checks off still holds on an install that serves no Environments.
  @Test
  void keepsKeycloaksOwnConfigurationCheck() {
    factory.init(null);
    assertEquals(List.of("trusted-hosts", "host-sending-registration-request-must-match", "client-uris-must-match"),
        propertyNames(factory.getConfigProperties()));
    assertDoesNotThrow(() -> factory.validateConfiguration(null, null, component(true, true)));
    assertThrows(ComponentValidationException.class, () -> factory.validateConfiguration(null, null, component(false, false)));
  }

  private static TrustedHostClientRegistrationPolicyFactory stock() {
    return new TrustedHostClientRegistrationPolicyFactory();
  }

  private static List<String> propertyNames(List<ProviderConfigProperty> properties) {
    return properties.stream().map(ProviderConfigProperty::getName).toList();
  }

  private static ComponentModel component(boolean hostMustMatch, boolean urisMustMatch) {
    ComponentModel model = new ComponentModel();
    model.put("host-sending-registration-request-must-match", hostMustMatch);
    model.put("client-uris-must-match", urisMustMatch);
    return model;
  }
}
