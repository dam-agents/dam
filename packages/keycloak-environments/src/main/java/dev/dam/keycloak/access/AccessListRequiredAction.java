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
 * List at the end of every sign-in to the platform realm. A required action
 * runs on each way in — the login form, an identity provider, a password
 * grant — after the person is known and before a session is handed out, so
 * one check covers them all. An address not on the list sees "not on the
 * access list"; a check that cannot reach the platform sees "temporarily
 * unavailable", and both are refused. A holder of the operator role is never
 * checked, so the people who manage the list cannot be locked out by it.
 */
public class AccessListRequiredAction implements RequiredActionProvider {
  static final String NOT_LISTED = "Your account is not on this platform's access list. Ask its operators to add you.";
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
    if (applies(context)) context.getAuthenticationSession().addRequiredAction(AccessListRequiredActionFactory.ID);
  }

  @Override
  public void requiredActionChallenge(RequiredActionContext context) {
    if (!applies(context)) {
      context.success();
      return;
    }
    if (isOperator(context)) {
      context.success();
      return;
    }
    switch (check.apply(context.getUser().getEmail())) {
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
