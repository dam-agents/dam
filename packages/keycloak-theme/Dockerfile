FROM quay.io/keycloak/keycloak:26.6.2-2@sha256:f9ba7b2af90db8dc749a57ca9aedca51e840cb9224441ab546a968da941da900

COPY packages/keycloak-theme/dist_keycloak/keycloak-theme-for-kc-all-other-versions.jar \
    /opt/keycloak/providers/keycloak-theme.jar

RUN /opt/keycloak/bin/kc.sh build
