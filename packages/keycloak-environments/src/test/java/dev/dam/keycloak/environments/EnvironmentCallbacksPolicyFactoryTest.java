// TEST_OVERVIEW: The registration policy the extension runs on an install that serves Environments: a client that registers itself passes only with callbacks the install lists, and the extension advertises no config properties of its own, since the callback list is the whole configuration.
package dev.dam.keycloak.environments;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.keycloak.component.ComponentModel;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.representations.idm.ClientRepresentation;
import org.keycloak.services.clientregistration.policy.ClientRegistrationPolicy;
import org.keycloak.services.clientregistration.policy.ClientRegistrationPolicyException;

class EnvironmentCallbacksPolicyFactoryTest {
  private static final String TEMPLATE = "https://{host}.env.example.com";
  private final EnvironmentCallbacksPolicyFactory factory = new EnvironmentCallbacksPolicyFactory();

  // TEST_SCENARIO: Keycloak puts the provider id trusted-hosts in every realm, so the extension keeps that id and a higher order whether or not the install serves Environments; a realm never ends up with no registration policy.
  @Test
  void keepsTheIdAndOrderInBothModes() {
    assertEquals("trusted-hosts", factory.getId());
    assertEquals(100, factory.order());
    factory.configure(EnvironmentsConfig.of(TEMPLATE, List.of()));
    assertEquals("trusted-hosts", factory.getId());
    assertEquals(100, factory.order());
  }

  // TEST_SCENARIO: with a template the install serves Environments, and a client that registers itself passes only with callbacks the install lists.
  @Test
  void enforcesTheCallbackListWithEnvironments() {
    factory.configure(EnvironmentsConfig.of(TEMPLATE, List.of("http://localhost", "cursor:")));
    ClientRegistrationPolicy policy = factory.create(null, component());
    assertInstanceOf(EnvironmentCallbacksPolicy.class, policy);
    assertDoesNotThrow(() -> callbacks(policy, "http://localhost:64981/callback", "cursor://anysphere.cursor-retrieval/oauth/callback"));
    assertThrows(ClientRegistrationPolicyException.class, () -> callbacks(policy, "https://evil.example/callback"));
    assertThrows(ClientRegistrationPolicyException.class, () -> callbacks(policy));
  }

  // TEST_SCENARIO: the install's callback list is the whole configuration of this policy, so with Environments it advertises no config property and adds no configuration check of its own.
  @Test
  void configuresNothingWithEnvironments() {
    factory.configure(EnvironmentsConfig.of(TEMPLATE, List.of("http://localhost")));
    assertDoesNotThrow(() -> factory.validateConfiguration(null, null, component()));
    assertEquals(List.of(), names(factory.getConfigProperties()));
  }

  private static List<String> names(List<ProviderConfigProperty> properties) {
    return properties.stream().map(ProviderConfigProperty::getName).toList();
  }

  private static ComponentModel component() {
    ComponentModel model = new ComponentModel();
    model.put("host-sending-registration-request-must-match", false);
    model.put("client-uris-must-match", false);
    return model;
  }

  private static void callbacks(ClientRegistrationPolicy policy, String... callbacks) {
    ClientRepresentation client = new ClientRepresentation();
    client.setRedirectUris(List.of(callbacks));
    ((EnvironmentCallbacksPolicy) policy).check(client);
  }
}
