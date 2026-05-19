-- ADR-045: clear plaintext refresh tokens once the api-server encrypts the
-- column. Existing linked users re-OAuth on next interaction; tokens are
-- short-lived (Keycloak default 30d) and re-link is one click.
UPDATE "identity_links" SET "refresh_token" = NULL;
