// TEST_OVERVIEW: Keycloak's question to the platform, whether one email may sign in. It sends the address lowercased with the install's shared secret, and only a 200 that says allowed lets the person in; a 200 that says not allowed refuses them, and every other answer, an unreachable platform or a missing secret is unavailable, never allowed.
package dev.dam.keycloak.access;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.dam.keycloak.access.AccessCheck.Verdict;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpConnectTimeoutException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Flow;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.SSLSession;
import org.junit.jupiter.api.Test;

class AccessCheckTest {
  private static final AccessListConfig CONFIG = new AccessListConfig(
      Optional.of(URI.create("http://api.local:4000/internal/access-check")), "s3cret", "platform", "platform-operator", Duration.ofSeconds(1));

  // TEST_SCENARIO: the platform's 200 answer decides: allowed lets the person in, not allowed refuses them; the request names the address lowercased and carries the secret.
  @Test
  void followsThePlatformsAnswer() {
    List<HttpRequest> sent = new ArrayList<>();
    AccessCheck yes = new AccessCheck(CONFIG, req -> { sent.add(req); return response(200, "{\"allowed\":true}"); });
    assertEquals(Verdict.ALLOWED, yes.check(" Ada@Example.com "));
    assertEquals("Bearer s3cret", sent.get(0).headers().firstValue("Authorization").orElseThrow());
    assertEquals("{\"email\":\"ada@example.com\"}", bodyOf(sent.get(0)));
    AccessCheck no = new AccessCheck(CONFIG, req -> response(200, "{\"allowed\":false}"));
    assertEquals(Verdict.DENIED, no.check("eve@example.com"));
  }

  // TEST_SCENARIO: a timeout, a refused secret, a server error or an answer that says neither is unavailable, so an outage never lets everyone in.
  @Test
  void failsClosed() {
    assertEquals(Verdict.UNAVAILABLE, new AccessCheck(CONFIG, req -> { throw new HttpConnectTimeoutException("HTTP connect timed out"); }).check("ada@example.com"));
    assertEquals(Verdict.UNAVAILABLE, new AccessCheck(CONFIG, req -> response(401, "{}")).check("ada@example.com"));
    assertEquals(Verdict.UNAVAILABLE, new AccessCheck(CONFIG, req -> response(503, "{}")).check("ada@example.com"));
    assertEquals(Verdict.UNAVAILABLE, new AccessCheck(CONFIG, req -> response(200, "{\"allowed\":\"yes\"}")).check("ada@example.com"));
    assertEquals(Verdict.UNAVAILABLE, new AccessCheck(CONFIG, req -> response(200, "not json")).check("ada@example.com"));
  }

  // TEST_SCENARIO: a person with no email is refused without a call, and an install with a URL but no secret is unavailable without a call.
  @Test
  void needsAnEmailAndASecret() {
    AccessCheck.Transport never = req -> { throw new AssertionError("no call expected"); };
    assertEquals(Verdict.DENIED, new AccessCheck(CONFIG, never).check(null));
    assertEquals(Verdict.DENIED, new AccessCheck(CONFIG, never).check(" "));
    AccessListConfig noSecret = new AccessListConfig(CONFIG.checkUrl(), "", "platform", "platform-operator", Duration.ofSeconds(1));
    assertEquals(Verdict.UNAVAILABLE, new AccessCheck(noSecret, never).check("ada@example.com"));
  }

  // TEST_SCENARIO: an install without a check URL checks no list.
  @Test
  void offWithoutAUrl() {
    assertTrue(CONFIG.enabled());
    assertEquals(false, new AccessListConfig(Optional.empty(), "", "platform", "platform-operator", Duration.ofSeconds(1)).enabled());
  }

  private static String bodyOf(HttpRequest request) {
    StringBuilder out = new StringBuilder();
    request.bodyPublisher().orElseThrow().subscribe(new Flow.Subscriber<ByteBuffer>() {
      @Override public void onSubscribe(Flow.Subscription s) { s.request(Long.MAX_VALUE); }
      @Override public void onNext(ByteBuffer item) { out.append(StandardCharsets.UTF_8.decode(item)); }
      @Override public void onError(Throwable t) { }
      @Override public void onComplete() { }
    });
    return out.toString();
  }

  private static HttpResponse<String> response(int status, String body) {
    return new HttpResponse<>() {
      @Override public int statusCode() { return status; }
      @Override public HttpRequest request() { return null; }
      @Override public Optional<HttpResponse<String>> previousResponse() { return Optional.empty(); }
      @Override public HttpHeaders headers() { return HttpHeaders.of(Map.of(), (a, b) -> true); }
      @Override public String body() { return body; }
      @Override public Optional<SSLSession> sslSession() { return Optional.empty(); }
      @Override public URI uri() { return CONFIG.checkUrl().get(); }
      @Override public HttpClient.Version version() { return HttpClient.Version.HTTP_1_1; }
    };
  }
}
