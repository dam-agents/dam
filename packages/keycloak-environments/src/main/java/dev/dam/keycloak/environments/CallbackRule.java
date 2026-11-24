package dev.dam.keycloak.environments;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;
import java.util.Locale;

/*
 * UNIT_BOUNDARY_DESCRIPTION: Which callback a client that registers itself
 * may name, so a sign-in code only ever goes back to an app on the person's
 * own machine or to a known client's site. A loopback entry (`http://localhost`,
 * `http://127.0.0.1`, `http://[::1]`) allows any port and path on that
 * address (RFC 8252); an https entry allows that origin and any path under
 * it; an app scheme (`cursor:`) allows that scheme alone. Anything else is
 * refused, and so is a callback with userinfo or a fragment.
 */
public final class CallbackRule {
  private final List<String> entries;

  public CallbackRule(List<String> entries) {
    this.entries = entries.stream().map(String::trim).filter(e -> !e.isEmpty()).map(e -> e.toLowerCase(Locale.ROOT)).toList();
  }

  public boolean allows(String callback) {
    if (callback == null || callback.isEmpty()) return false;
    URI uri;
    try {
      uri = new URI(callback);
    } catch (URISyntaxException e) {
      return false;
    }
    if (uri.getScheme() == null || uri.getRawFragment() != null || uri.getRawUserInfo() != null) return false;
    String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
    for (String entry : entries) {
      if (entry.endsWith(":") && !entry.contains("/")) {
        if (scheme.equals(entry.substring(0, entry.length() - 1)) && !scheme.equals("http") && !scheme.equals("https")) return true;
        continue;
      }
      URI allowed = URI.create(entry);
      if (!scheme.equals(allowed.getScheme()) || uri.getHost() == null) continue;
      if (!uri.getHost().toLowerCase(Locale.ROOT).equals(allowed.getHost())) continue;
      if (scheme.equals("http")) {
        if (isLoopback(allowed.getHost())) return true;
        continue;
      }
      if (uri.getPort() == allowed.getPort()) return true;
    }
    return false;
  }

  private static boolean isLoopback(String host) {
    return host.equals("localhost") || host.equals("127.0.0.1") || host.equals("[::1]");
  }
}
