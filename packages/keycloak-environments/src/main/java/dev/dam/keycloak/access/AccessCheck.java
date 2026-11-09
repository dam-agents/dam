package dev.dam.keycloak.access;

import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Locale;
import org.keycloak.util.JsonSerialization;

/*
 * UNIT_BOUNDARY_DESCRIPTION: Asks the platform's api-server whether one email
 * is on the install's Access List, over the cluster-internal
 * `/internal/access-check` with the shared secret. The answer is one of three:
 * allowed, not allowed, or unavailable — a refused secret, a timeout or any
 * other failure is unavailable, never allowed, so an outage keeps people out
 * instead of letting everyone in. A person with no email is not allowed.
 */
public final class AccessCheck {
  public enum Verdict { ALLOWED, DENIED, UNAVAILABLE }

  public interface Transport {
    HttpResponse<String> send(HttpRequest request) throws IOException, InterruptedException;
  }

  private final AccessListConfig config;
  private final Transport transport;

  public AccessCheck(AccessListConfig config, Transport transport) {
    this.config = config;
    this.transport = transport;
  }

  public static AccessCheck overHttp(AccessListConfig config) {
    HttpClient client = HttpClient.newBuilder().connectTimeout(config.timeout()).build();
    return new AccessCheck(config, request -> client.send(request, HttpResponse.BodyHandlers.ofString()));
  }

  public Verdict check(String email) {
    if (email == null || email.isBlank()) return Verdict.DENIED;
    if (config.checkUrl().isEmpty() || config.secret().isEmpty()) return Verdict.UNAVAILABLE;
    try {
      String body = JsonSerialization.writeValueAsString(
          java.util.Map.of("email", email.trim().toLowerCase(Locale.ROOT)));
      HttpRequest request = HttpRequest.newBuilder(config.checkUrl().get())
          .timeout(config.timeout())
          .header("Authorization", "Bearer " + config.secret())
          .header("Content-Type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(body))
          .build();
      HttpResponse<String> response = transport.send(request);
      if (response.statusCode() != 200) return Verdict.UNAVAILABLE;
      Object allowed = JsonSerialization.readValue(response.body(), java.util.Map.class).get("allowed");
      if (Boolean.TRUE.equals(allowed)) return Verdict.ALLOWED;
      if (Boolean.FALSE.equals(allowed)) return Verdict.DENIED;
      return Verdict.UNAVAILABLE;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return Verdict.UNAVAILABLE;
    } catch (IOException | RuntimeException e) {
      return Verdict.UNAVAILABLE;
    }
  }
}
