package dev.dam.keycloak.environments;

import java.net.URI;
import java.util.List;
import java.util.Optional;

/*
 * UNIT_BOUNDARY_DESCRIPTION: The install's Environment addresses, allowed
 * callbacks and realm, read from the environment variables the chart sets on
 * Keycloak (`DAM_ENVIRONMENTS_URL_TEMPLATE`, `DAM_ENVIRONMENTS_REDIRECTS`,
 * `DAM_ENVIRONMENTS_REALM`): one source for the mapper, the client-policy
 * executor and the registration policy, which are three SPIs with options of
 * their own each. Without a template the install serves no Environments, and
 * every check refuses.
 */
public record EnvironmentsConfig(Optional<EnvironmentResource> resource, CallbackRule callbacks, String realm) {
  public static final String SCOPE = "environments";

  public static EnvironmentsConfig fromEnvironment() {
    String template = System.getenv().getOrDefault("DAM_ENVIRONMENTS_URL_TEMPLATE", "");
    String redirects = System.getenv().getOrDefault("DAM_ENVIRONMENTS_REDIRECTS", "");
    String realm = System.getenv().getOrDefault("DAM_ENVIRONMENTS_REALM", "platform");
    return new EnvironmentsConfig(parseTemplate(template), new CallbackRule(List.of(redirects.split("[\\s,]+"))), realm);
  }

  public static EnvironmentsConfig of(String template, List<String> redirects) {
    return new EnvironmentsConfig(parseTemplate(template), new CallbackRule(redirects), "platform");
  }

  private static Optional<EnvironmentResource> parseTemplate(String template) {
    if (template == null || !template.contains("{host}")) return Optional.empty();
    URI uri = URI.create(template.replace("{host}", "h"));
    String host = uri.getHost();
    if (host == null || !host.startsWith("h.")) return Optional.empty();
    return Optional.of(new EnvironmentResource(uri.getScheme(), host.substring(2), uri.getPort()));
  }
}
