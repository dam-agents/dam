package dev.dam.keycloak.access;

import dev.dam.keycloak.access.AccessCheck.Verdict;
import jakarta.ws.rs.core.Response;
import java.util.function.Function;
import org.jboss.logging.Logger;
import org.keycloak.authentication.RequiredActionContext;
import org.keycloak.authentication.RequiredActionProvider;
import org.keycloak.models.RoleModel;

/*
 * UNIT_BOUNDARY_DESCRIPTION: Checks the person against the install's Access
 * List at the end of every sign-in to the platform realm. Keycloak evaluates
 * a required action's triggers on each way in — the login form, an identity
 * provider, a password grant — after the person is known and before a session
 * is handed out, so the check runs there, once, and the action is added only
 * for a person it refuses: a password grant with an action pending is
 * refused, and a browser sees the action's page. That page says "not on the
 * access list", or "temporarily unavailable" when the check could not reach
 * the platform. A holder of the operator role is never checked, so the people
 * who manage the list cannot be locked out by it.
 */
public class AccessListRequiredAction implements RequiredActionProvider {
  static final String NOT_LISTED = "Your account is not on this platform's access list. Ask its operators to add you.";
  static final String VERDICT_NOTE = "dam.access-list.verdict";
  static final String UNAVAILABLE = "Sign-in is temporarily unavailable. Please try again later.";
  private static final Logger LOG = Logger.getLogger(AccessListRequiredAction.class);

  private final AccessListConfig config;
  private final Function<String, Verdict> check;

  public AccessListRequiredAction(AccessListConfig config, Function<String, Verdict> check) {
    this.config = config;
    this.check = check;
  }

  @Override
  public void evaluateTriggers(RequiredActionContext context) {
    if (!applies(context) || isOperator(context)) return;
    Verdict verdict = check.apply(context.getUser().getEmail());
    if (verdict == Verdict.ALLOWED) return;
    context.getAuthenticationSession().setAuthNote(VERDICT_NOTE, verdict.name());
    context.getAuthenticationSession().addRequiredAction(AccessListRequiredActionFactory.ID);
  }

  @Override
  public void requiredActionChallenge(RequiredActionContext context) {
    if (!applies(context) || isOperator(context)) {
      context.success();
      return;
    }
    String noted = context.getAuthenticationSession().getAuthNote(VERDICT_NOTE);
    Verdict verdict = noted != null ? Verdict.valueOf(noted) : check.apply(context.getUser().getEmail());
    switch (verdict) {
      case ALLOWED -> context.success();
      case DENIED -> {
        LOG.infof("dam-access: user %s is not on the access list", context.getUser().getId());
        refuse(context, NOT_LISTED, Response.Status.FORBIDDEN);
      }
      case UNAVAILABLE -> {
        LOG.warnf("dam-access: access check unavailable for user %s", context.getUser().getId());
        refuse(context, UNAVAILABLE, Response.Status.SERVICE_UNAVAILABLE);
      }
    }
  }

  @Override
  public void processAction(RequiredActionContext context) {
    requiredActionChallenge(context);
  }

  @Override
  public void close() { }

  private boolean applies(RequiredActionContext context) {
    return config.enabled() && config.realm().equals(context.getRealm().getName());
  }

  private boolean isOperator(RequiredActionContext context) {
    if (config.operatorRole().isEmpty()) return false;
    RoleModel role = context.getRealm().getRole(config.operatorRole());
    return role != null && context.getUser().hasRole(role);
  }

  private static void refuse(RequiredActionContext context, String message, Response.Status status) {
    context.challenge(context.form().setError(message).createErrorPage(status));
  }
}
