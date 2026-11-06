package dev.dam.keycloak.environments;

import java.util.List;
import java.util.Optional;
import org.keycloak.Config;
import org.keycloak.models.ClientSessionContext;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.ProtocolMapperModel;
import org.keycloak.models.UserSessionModel;
import org.keycloak.protocol.oidc.mappers.AbstractOIDCProtocolMapper;
import org.keycloak.protocol.oidc.mappers.OIDCAccessTokenMapper;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.representations.AccessToken;

/*
 * UNIT_BOUNDARY_DESCRIPTION: The `environments` client scope's mapper. It
 * sets an access token's audience to exactly the one Environment endpoint the
 * sign-in named in its RFC 8707 `resource`, and to nothing else, so a token a
 * person's client sends to one Environment opens no other Environment and
 * never the platform's API. Keycloak keeps the authorization request's
 * `resource` as a note of the client session, which every refresh of an
 * offline session reads again, so the audience outlives refreshes unchanged.
 * A note that fails the address rule leaves the token with no audience at all,
 * which the gate refuses.
 */
public class EnvironmentAudienceMapper extends AbstractOIDCProtocolMapper implements OIDCAccessTokenMapper {
  public static final String ID = "dam-environment-audience";
  public static final String RESOURCE_NOTE = "resource";

  private EnvironmentsConfig config = EnvironmentsConfig.of("", List.of());

  @Override public String getId() { return ID; }
  @Override public String getDisplayType() { return "Environment audience"; }
  @Override public String getDisplayCategory() { return TOKEN_MAPPER_CATEGORY; }
  @Override public String getHelpText() { return "Sets the audience to the one Environment endpoint the sign-in named as its resource."; }
  @Override public List<ProviderConfigProperty> getConfigProperties() { return List.of(); }
  @Override public int getPriority() { return Integer.MAX_VALUE; }

  @Override
  public void init(Config.Scope scope) {
    config = EnvironmentsConfig.fromEnvironment();
  }

  @Override
  public void postInit(KeycloakSessionFactory factory) {
    if (config.resource().isPresent()) RealmSetup.register(config.realm(), factory);
  }

  public void configure(EnvironmentsConfig config) {
    this.config = config;
  }

  @Override
  public AccessToken transformAccessToken(AccessToken token, ProtocolMapperModel model, KeycloakSession session,
      UserSessionModel userSession, ClientSessionContext context) {
    token.audience((String[]) null);
    audienceOf(context.getClientSession().getNote(RESOURCE_NOTE)).ifPresent(token::audience);
    return token;
  }

  public Optional<String> audienceOf(String resource) {
    return config.resource().flatMap(rule -> rule.accept(resource));
  }
}
