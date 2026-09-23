use std::time::Duration;

use base64::Engine;
use serde_json::{Map, Value};

// UNIT_BOUNDARY_DESCRIPTION: the registry credentials the image cache service fetches with, built from the install's default agent pull Secrets in the order they are listed, as packages/controller/pkg/pullauth does for a machine: one docker config per Secret, kept apart rather than merged, because the kubelet tries each Secret in turn and a stale credential for a registry must not hide a good one listed after it. A Secret that is missing, or holds no docker config it can parse, is skipped with a warning, because the kubelet skips it too and the fetch can still work without it. Each document holds the credentials themselves, so none goes into a log or an error message; only Secret names do.
pub struct PullSecrets {
    api: String,
    namespace: String,
    names: Vec<String>,
    client: reqwest::Client,
}

const SERVICE_ACCOUNT: &str = "/var/run/secrets/kubernetes.io/serviceaccount";
const READ_TIMEOUT: Duration = Duration::from_secs(30);

impl PullSecrets {
    // UNIT_BOUNDARY_DESCRIPTION: a reader for the pod's own cluster, through the API server's Service and the pod's service account. The token is read again for every pass, because a projected token is rotated under a running pod.
    pub fn in_cluster(namespace: &str, names: Vec<String>) -> anyhow::Result<Self> {
        let host = std::env::var("KUBERNETES_SERVICE_HOST").map_err(|_| {
            anyhow::anyhow!("not running in a cluster: KUBERNETES_SERVICE_HOST is unset")
        })?;
        let port = std::env::var("KUBERNETES_SERVICE_PORT").unwrap_or_else(|_| "443".into());
        let host = if host.contains(':') {
            format!("[{host}]")
        } else {
            host
        };
        let ca = std::fs::read(format!("{SERVICE_ACCOUNT}/ca.crt"))
            .map_err(|e| anyhow::anyhow!("reading the cluster CA: {e}"))?;
        let client = reqwest::Client::builder()
            .add_root_certificate(reqwest::Certificate::from_pem(&ca)?)
            .timeout(READ_TIMEOUT)
            .build()?;
        Ok(Self {
            api: format!("https://{host}:{port}"),
            namespace: namespace.to_string(),
            names,
            client,
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: one docker config per Secret that names a registry, in the order the Secrets are listed, and none when no Secret does. Only an API error is returned, so the caller can tell a Secret that is not there from a read that did not happen.
    pub async fn resolve(&self) -> anyhow::Result<Vec<String>> {
        let token = std::fs::read_to_string(format!("{SERVICE_ACCOUNT}/token"))
            .map_err(|e| anyhow::anyhow!("reading the service account token: {e}"))?;
        let mut docs = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for name in &self.names {
            if name.is_empty() || !seen.insert(name) {
                continue;
            }
            let response = self
                .client
                .get(format!(
                    "{}/api/v1/namespaces/{}/secrets/{name}",
                    self.api, self.namespace
                ))
                .bearer_auth(token.trim())
                .send()
                .await
                .map_err(|e| anyhow::anyhow!("reading image pull secret {name}: {e}"))?;
            if response.status() == reqwest::StatusCode::NOT_FOUND {
                tracing::warn!(secret = %name, "image pull secret not found, fetching without it");
                continue;
            }
            if !response.status().is_success() {
                anyhow::bail!(
                    "reading image pull secret {name}: the API server answered {}",
                    response.status()
                );
            }
            let body = response
                .bytes()
                .await
                .map_err(|e| anyhow::anyhow!("reading image pull secret {name}: {e}"))?;
            match serde_json::from_slice::<Value>(&body)
                .ok()
                .and_then(|secret| auths_of(&secret))
            {
                Some(auths) if !auths.is_empty() => {
                    docs.push(serde_json::json!({ "auths": auths }).to_string())
                }
                _ => {
                    tracing::warn!(secret = %name, "image pull secret holds no docker config, fetching without it")
                }
            }
        }
        Ok(docs)
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the registries a Secret's docker config names, from either of the two keys a pull Secret is written under: `.dockerconfigjson`, a whole config with its registries under `auths`, or the older `.dockercfg`, which is the registries alone.
fn auths_of(secret: &Value) -> Option<Map<String, Value>> {
    let data = secret.get("data")?;
    let decode = |key: &str| -> Option<Value> {
        let raw = base64::engine::general_purpose::STANDARD
            .decode(data.get(key)?.as_str()?)
            .ok()?;
        serde_json::from_slice(&raw).ok()
    };
    if data.get(".dockerconfigjson").is_some() {
        return match decode(".dockerconfigjson")?.get("auths") {
            Some(Value::Object(auths)) => Some(auths.clone()),
            Some(_) => None,
            None => Some(Map::new()),
        };
    }
    match decode(".dockercfg")? {
        Value::Object(auths) => Some(auths),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gosource;

    fn secret(key: &str, doc: &str) -> Value {
        serde_json::json!({
            "data": { key: base64::engine::general_purpose::STANDARD.encode(doc) }
        })
    }

    // TEST_SCENARIO: a pod lists several pull Secrets and the kubelet tries each. Their registries are read from both keys a Secret is written under, and the Secrets are kept apart rather than merged: the Go controller hands a machine the same list, so a stale credential for a registry does not hide a good one a later Secret holds.
    #[test]
    fn each_secret_keeps_its_own_registries() {
        let first = auths_of(&secret(
            ".dockerconfigjson",
            r#"{"auths":{"quay.io":{"auth":"Zmlyc3Q="}}}"#,
        ))
        .unwrap();
        let second = auths_of(&secret(
            ".dockercfg",
            r#"{"quay.io":{"auth":"c2Vjb25k"},"ghcr.io":{"auth":"Z2hjcg=="}}"#,
        ))
        .unwrap();
        assert_eq!(first["quay.io"]["auth"], "Zmlyc3Q=");
        assert_eq!(second["quay.io"]["auth"], "c2Vjb25k");
        assert_eq!(second["ghcr.io"]["auth"], "Z2hjcg==");

        let go = gosource::read_in("pullauth", "pullauth.go");
        let resolves = gosource::function_body(&go, "Resolve").expect("pullauth.go has a Resolve");
        assert!(
            resolves.contains("docs = append(docs, string(doc))") && !go.contains("func merge("),
            "the Go controller no longer keeps each Secret's docker config apart: {resolves}"
        );
    }

    // TEST_SCENARIO: a Secret that holds no docker config the service can read is skipped rather than failing the pass, and one whose config names no registry adds no document, so a pass with nothing to fetch with is an anonymous fetch rather than one with an empty config.
    #[test]
    fn a_secret_without_a_docker_config_adds_nothing() {
        assert!(auths_of(&serde_json::json!({ "data": { "token": "eA==" } })).is_none());
        assert!(auths_of(&secret(".dockerconfigjson", "not json")).is_none());
        assert!(auths_of(&secret(".dockerconfigjson", "{}"))
            .unwrap()
            .is_empty());
    }
}
