// TEST_OVERVIEW: the required action every sign-in to the platform realm passes through when the install checks its Access List. An allowed address goes on; an address not on the list and a check that cannot reach the platform are both refused with a page saying which; a realm other than the platform's, or an install with no check URL, is never checked. At start the action is turned on in the realm when the install checks the list, and off when it does not.
package dev.dam.keycloak.access;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.dam.keycloak.access.AccessCheck.Verdict;
import jakarta.ws.rs.core.Response;
import java.lang.reflect.Proxy;
import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.keycloak.authentication.RequiredActionContext;
import org.keycloak.forms.login.LoginFormsProvider;
import org.keycloak.models.RealmModel;
import org.keycloak.models.RequiredActionProviderModel;
import org.keycloak.models.RoleModel;
import org.keycloak.models.UserModel;
import org.keycloak.sessions.AuthenticationSessionModel;

class AccessListRequiredActionTest {
  private static final AccessListConfig ON = new AccessListConfig(
      Optional.of(URI.create("http://api.local/internal/access-check")), "s3cret", "platform", "platform-operator", Duration.ofSeconds(1));
  private static final AccessListConfig OFF = new AccessListConfig(Optional.empty(), "", "platform", "platform-operator", Duration.ofSeconds(1));

  // TEST_SCENARIO: an allowed address goes on with no page shown.
  @Test
  void letsAnAllowedPersonIn() {
    Recorder r = run(ON, "platform", Verdict.ALLOWED);
    assertEquals(List.of("success"), r.outcomes);
  }

  // TEST_SCENARIO: an address not on the list sees the not-on-the-list page with 403; an unreachable platform sees the unavailable page with 503, and both are refused.
  @Test
  void refusesWithThePageThatSaysWhy() {
    Recorder denied = run(ON, "platform", Verdict.DENIED);
    assertEquals(List.of("challenge"), denied.outcomes);
    assertEquals(AccessListRequiredAction.NOT_LISTED, denied.error);
    assertEquals(Response.Status.FORBIDDEN, denied.status);
    Recorder unavailable = run(ON, "platform", Verdict.UNAVAILABLE);
    assertEquals(List.of("challenge"), unavailable.outcomes);
    assertEquals(AccessListRequiredAction.UNAVAILABLE, unavailable.error);
    assertEquals(Response.Status.SERVICE_UNAVAILABLE, unavailable.status);
  }

  // TEST_SCENARIO: a holder of the operator role goes on without a check, even when the list would refuse them or the platform is unreachable, so the list's managers are never locked out.
  @Test
  void letsAnOperatorInUnchecked() {
    Recorder r = new Recorder();
    new AccessListRequiredAction(ON, email -> { throw new AssertionError("no check expected"); })
        .requiredActionChallenge(context(r, "platform", true));
    assertEquals(List.of("success"), r.outcomes);
  }

  // TEST_SCENARIO: the master realm, or an install that checks no list, is let through without asking the platform.
  @Test
  void checksOnlyThePlatformRealmOfAnInstallWithAList() {
    assertEquals(List.of("success"), run(ON, "master", null).outcomes);
    assertEquals(List.of("success"), run(OFF, "platform", null).outcomes);
  }

  // TEST_SCENARIO: the check runs when Keycloak evaluates triggers, and the action is added only for a refused person, with the verdict noted for its page; an allowed person, an operator, another realm and an install with no list add nothing, so a password grant for them is not held up.
  @Test
  void addsTheActionOnlyForARefusedPerson() {
    Recorder denied = trigger(ON, "platform", false, Verdict.DENIED);
    assertEquals(List.of(AccessListRequiredActionFactory.ID), denied.added);
    assertEquals("DENIED", denied.notes.get(AccessListRequiredAction.VERDICT_NOTE));
    assertEquals(List.of(AccessListRequiredActionFactory.ID), trigger(ON, "platform", false, Verdict.UNAVAILABLE).added);
    assertEquals(List.of(), trigger(ON, "platform", false, Verdict.ALLOWED).added);
    assertEquals(List.of(), trigger(ON, "platform", true, null).added);
    assertEquals(List.of(), trigger(ON, "master", false, null).added);
    assertEquals(List.of(), trigger(OFF, "platform", false, null).added);
  }

  // TEST_SCENARIO: the page follows the verdict noted at the trigger, without asking the platform again.
  @Test
  void showsTheNotedVerdict() {
    Recorder r = new Recorder();
    r.notes.put(AccessListRequiredAction.VERDICT_NOTE, "UNAVAILABLE");
    new AccessListRequiredAction(ON, email -> { throw new AssertionError("no check expected"); })
        .requiredActionChallenge(context(r, "platform", false));
    assertEquals(AccessListRequiredAction.UNAVAILABLE, r.error);
  }

  // TEST_SCENARIO: at start the action is added to a realm that lacks it when the list is on, turned off when it is not, and a realm with no action and no list is left alone.
  @Test
  void turnsTheActionOnAndOffInTheRealm() {
    RealmStub realm = new RealmStub();
    AccessListSetup.ensure(realm.model, false);
    assertNull(realm.action);
    AccessListSetup.ensure(realm.model, true);
    assertTrue(realm.action.isEnabled());
    assertEquals(AccessListRequiredActionFactory.ID, realm.action.getProviderId());
    AccessListSetup.ensure(realm.model, false);
    assertFalse(realm.action.isEnabled());
  }

  private static final class Recorder {
    final List<String> outcomes = new ArrayList<>();
    final List<String> added = new ArrayList<>();
    final Map<String, String> notes = new HashMap<>();
    String error;
    Response.Status status;
  }

  private static Recorder run(AccessListConfig config, String realmName, Verdict verdict) {
    Recorder r = new Recorder();
    new AccessListRequiredAction(config, email -> {
      if (verdict == null) throw new AssertionError("no check expected");
      return verdict;
    }).requiredActionChallenge(context(r, realmName));
    return r;
  }

  private static Recorder trigger(AccessListConfig config, String realmName, boolean operator, Verdict verdict) {
    Recorder r = new Recorder();
    new AccessListRequiredAction(config, email -> {
      if (verdict == null) throw new AssertionError("no check expected");
      return verdict;
    }).evaluateTriggers(context(r, realmName, operator));
    return r;
  }

  private static RequiredActionContext context(Recorder r, String realmName) {
    return context(r, realmName, false);
  }

  private static RequiredActionContext context(Recorder r, String realmName, boolean operator) {
    RoleModel operatorRole = stub(RoleModel.class, (name, args) -> null);
    RealmModel realm = stub(RealmModel.class, (name, args) -> switch (name) {
      case "getName" -> realmName;
      case "getRole" -> "platform-operator".equals(args[0]) ? operatorRole : null;
      default -> null;
    });
    UserModel user = stub(UserModel.class, (name, args) -> switch (name) {
      case "getEmail" -> "ada@example.com";
      case "getId" -> "user-1";
      case "hasRole" -> operator && args[0] == operatorRole;
      default -> null;
    });
    AuthenticationSessionModel authSession = stub(AuthenticationSessionModel.class, (name, args) -> switch (name) {
      case "addRequiredAction" -> { r.added.add(String.valueOf(args[0])); yield null; }
      case "setAuthNote" -> { r.notes.put((String) args[0], (String) args[1]); yield null; }
      case "getAuthNote" -> r.notes.get((String) args[0]);
      default -> null;
    });
    LoginFormsProvider[] form = new LoginFormsProvider[1];
    form[0] = stub(LoginFormsProvider.class, (name, args) -> switch (name) {
      case "setError" -> { r.error = (String) args[0]; yield form[0]; }
      case "createErrorPage" -> { r.status = (Response.Status) args[0]; yield null; }
      default -> null;
    });
    return stub(RequiredActionContext.class, (name, args) -> switch (name) {
      case "getRealm" -> realm;
      case "getUser" -> user;
      case "getAuthenticationSession" -> authSession;
      case "form" -> form[0];
      case "success" -> { r.outcomes.add("success"); yield null; }
      case "challenge" -> { r.outcomes.add("challenge"); yield null; }
      default -> null;
    });
  }

  private static final class RealmStub {
    RequiredActionProviderModel action;
    final RealmModel model = stub(RealmModel.class, (name, args) -> switch (name) {
      case "getName" -> "platform";
      case "getRequiredActionProviderByAlias" -> action;
      case "addRequiredActionProvider" -> { action = (RequiredActionProviderModel) args[0]; yield action; }
      default -> null;
    });
  }

  private interface Answer {
    Object answer(String method, Object[] args);
  }

  @SuppressWarnings("unchecked")
  private static <T> T stub(Class<T> type, Answer answer) {
    return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] { type },
        (proxy, method, args) -> answer.answer(method.getName(), args));
  }
}
