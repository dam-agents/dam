package dev.dam.keycloak.environments;

import org.keycloak.models.ClientModel;
import org.keycloak.representations.idm.ClientRepresentation;
import org.keycloak.services.clientregistration.ClientRegistrationContext;
import org.keycloak.services.clientregistration.ClientRegistrationProvider;
import org.keycloak.services.clientregistration.policy.ClientRegistrationPolicy;
import org.keycloak.services.clientregistration.policy.ClientRegistrationPolicyException;

/*
 * UNIT_BOUNDARY_DESCRIPTION: The anonymous client registration policy that
 * stands in for Keycloak's Trusted Hosts policy: it checks what a registering
 * client names as its callbacks against the install's list, since Trusted
 * Hosts compares hosts only and cannot allow an app scheme such as `cursor:`.
 * A client must name at least one callback and every one must be allowed, at
 * registration and at every update. A client it lets in is stamped with the
 * time it registered, which the daily cleanup of unused clients reads.
 */
public class EnvironmentCallbacksPolicy implements ClientRegistrationPolicy {
  private final CallbackRule rule;

  public EnvironmentCallbacksPolicy(CallbackRule rule) {
    this.rule = rule;
  }

  @Override public void beforeRegister(ClientRegistrationContext context) { check(context.getClient()); }
  @Override
  public void afterRegister(ClientRegistrationContext context, ClientModel client) {
    client.setAttribute(StaleClientsCleanup.REGISTERED_AT, java.time.Instant.now().toString());
  }
  @Override public void beforeUpdate(ClientRegistrationContext context, ClientModel client) { check(context.getClient()); }
  @Override public void afterUpdate(ClientRegistrationContext context, ClientModel client) { }
  @Override public void beforeView(ClientRegistrationProvider provider, ClientModel client) { }
  @Override public void beforeDelete(ClientRegistrationProvider provider, ClientModel client) { }

  void check(ClientRepresentation client) {
    var callbacks = client.getRedirectUris();
    if (callbacks == null || callbacks.isEmpty()) throw new ClientRegistrationPolicyException("a client must name its callback");
    for (String callback : callbacks)
      if (!rule.allows(callback)) throw new ClientRegistrationPolicyException("callback not allowed: " + callback);
  }
}
