package dev.dam.keycloak.access;

import java.net.URI;
import java.time.Duration;
import java.util.Optional;

/*
 * UNIT_BOUNDARY_DESCRIPTION: Where Keycloak asks whether an email may sign in,
 * read from the environment variables the chart sets on Keycloak
 * (`DAM_ACCESS_CHECK_URL`, `DAM_ACCESS_CHECK_SECRET`, `DAM_ACCESS_REALM`,
 * `DAM_ACCESS_OPERATOR_ROLE`). Holders of the operator role are let through
 * without a check, so an operator can always reach the page that fixes the list.
 * Without a URL the install checks no list, and the required action lets
 * everyone through; with a URL and no secret the configuration is broken, and
 * every sign-in is refused rather than let through unchecked.
 */
public record AccessListConfig(Optional<URI> checkUrl, String secret, String realm, String operatorRole, Duration timeout) {
  public static AccessListConfig fromEnvironment() {
    String url = System.getenv().getOrDefault("DAM_ACCESS_CHECK_URL", "");
    return new AccessListConfig(
        url.isBlank() ? Optional.empty() : Optional.of(URI.create(url.trim())),
        System.getenv().getOrDefault("DAM_ACCESS_CHECK_SECRET", ""),
        System.getenv().getOrDefault("DAM_ACCESS_REALM", "platform"),
        System.getenv().getOrDefault("DAM_ACCESS_OPERATOR_ROLE", ""),
        Duration.ofSeconds(5));
  }

  public boolean enabled() {
    return checkUrl.isPresent();
  }
}
