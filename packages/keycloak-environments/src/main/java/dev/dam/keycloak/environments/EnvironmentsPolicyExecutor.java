package dev.dam.keycloak.environments;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import org.keycloak.OAuthErrorException;
import org.keycloak.models.AuthenticatedClientSessionModel;
import org.keycloak.services.clientpolicy.ClientPolicyContext;
import org.keycloak.services.clientpolicy.ClientPolicyException;
import org.keycloak.services.clientpolicy.context.AuthorizationRequestContext;
import org.keycloak.services.clientpolicy.context.TokenRefreshResponseContext;
import org.keycloak.services.clientpolicy.context.TokenRequestContext;
import org.keycloak.services.clientpolicy.executor.ClientPolicyExecutorProvider;
import org.keycloak.representations.idm.ClientPolicyExecutorConfigurationRepresentation;

/*
 * UNIT_BOUNDARY_DESCRIPTION: The client-policy executor that keeps a sign-in
 * for Environments to exactly one Environment. A sign-in that asks for the
 * `environments` scope must name one Environment endpoint as its `resource`
 * (else `invalid_target`) and ask for `offline_access` (else `invalid_scope`):
 * only an offline session keeps one sign-in's resource apart from another of
 * the same client and person, and Keycloak's shared browser session would
 * otherwise let a second sign-in rewrite the first's audience. A code
 * exchange or a refresh that names another `resource` than the one signed in
 * is refused with `invalid_target`, so a client cannot widen its token later.
 */
public class EnvironmentsPolicyExecutor implements ClientPolicyExecutorProvider<ClientPolicyExecutorConfigurationRepresentation> {
  private final EnvironmentsConfig config;

  public EnvironmentsPolicyExecutor(EnvironmentsConfig config) {
    this.config = config;
  }

  @Override
  public String getProviderId() {
    return EnvironmentsPolicyExecutorFactory.ID;
  }

  @Override
  public void executeOnEvent(ClientPolicyContext context) throws ClientPolicyException {
    switch (context.getEvent()) {
      case AUTHORIZATION_REQUEST -> {
        AuthorizationRequestContext request = (AuthorizationRequestContext) context;
        checkSignIn(request.getAuthorizationEndpointRequest().getScope(), request.getRequestParameters().get("resource"));
      }
      case TOKEN_REQUEST -> {
        TokenRequestContext request = (TokenRequestContext) context;
        AuthenticatedClientSessionModel session = request.getClientSession();
        if (session != null) checkSameResource(session.getNote(EnvironmentAudienceMapper.RESOURCE_NOTE), request.getParams().get("resource"));
      }
      case TOKEN_REFRESH_RESPONSE -> {
        TokenRefreshResponseContext refresh = (TokenRefreshResponseContext) context;
        AuthenticatedClientSessionModel session = refresh.getClientSession();
        if (session != null) checkSameResource(session.getNote(EnvironmentAudienceMapper.RESOURCE_NOTE), refresh.getParams().get("resource"));
      }
      default -> { }
    }
  }

  void checkSignIn(String scope, List<String> resources) throws ClientPolicyException {
    if (!hasScope(scope, EnvironmentsConfig.SCOPE)) return;
    if (resources == null || resources.size() != 1 || accepted(resources.get(0)).isEmpty())
      throw new ClientPolicyException(OAuthErrorException.INVALID_TARGET, "resource must name one Environment endpoint");
    if (!hasScope(scope, "offline_access"))
      throw new ClientPolicyException(OAuthErrorException.INVALID_SCOPE, "the environments scope needs offline_access");
  }

  void checkSameResource(String signedIn, List<String> asked) throws ClientPolicyException {
    if (signedIn == null || asked == null || asked.isEmpty()) return;
    if (asked.size() != 1 || !asked.get(0).equals(signedIn))
      throw new ClientPolicyException(OAuthErrorException.INVALID_TARGET, "resource does not match the sign-in");
  }

  private Optional<String> accepted(String resource) {
    return config.resource().flatMap(rule -> rule.accept(resource));
  }

  static boolean hasScope(String scope, String wanted) {
    return scope != null && Arrays.asList(scope.trim().split("\\s+")).contains(wanted);
  }
}
