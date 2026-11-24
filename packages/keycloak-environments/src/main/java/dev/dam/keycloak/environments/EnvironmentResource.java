package dev.dam.keycloak.environments;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

/*
 * UNIT_BOUNDARY_DESCRIPTION: The one rule for an RFC 8707 `resource` value
 * that may become an access token's audience: the address of one Environment
 * endpoint, `<scheme>://<one DNS label>.<environments domain>[:<port>]`,
 * with the install's own scheme and port, and no path, query, fragment or
 * userinfo; a lone trailing `/` is the same address, since a URL parser adds
 * it (the MCP SDK sends `new URL(resource).href`). It returns the address
 * without that slash, the form the gate checks, or nothing, so a look-alike
 * host (`x.<domain>.evil.example`, a second label, a path) never yields an
 * audience.
 */
public final class EnvironmentResource {
  private static final Pattern LABEL = Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");

  private final String scheme;
  private final String domain;
  private final int port;

  public EnvironmentResource(String scheme, String domain, int port) {
    this.scheme = scheme.toLowerCase(Locale.ROOT);
    this.domain = domain.toLowerCase(Locale.ROOT);
    this.port = port;
  }

  public Optional<String> accept(String value) {
    if (value == null || value.isEmpty() || value.length() > 300) return Optional.empty();
    URI uri;
    try {
      uri = new URI(value);
    } catch (URISyntaxException e) {
      return Optional.empty();
    }
    if (!scheme.equals(uri.getScheme())) return Optional.empty();
    if (uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null) return Optional.empty();
    String path = uri.getRawPath();
    if (path != null && !path.isEmpty() && !path.equals("/")) return Optional.empty();
    if (uri.getPort() != port) return Optional.empty();
    String host = uri.getHost();
    if (host == null || !host.equals(host.toLowerCase(Locale.ROOT))) return Optional.empty();
    String suffix = "." + domain;
    if (!host.endsWith(suffix)) return Optional.empty();
    String label = host.substring(0, host.length() - suffix.length());
    if (!LABEL.matcher(label).matches()) return Optional.empty();
    String exact = scheme + "://" + host + (port == -1 ? "" : ":" + port);
    return exact.equals(value) || (exact + "/").equals(value) ? Optional.of(exact) : Optional.empty();
  }
}
