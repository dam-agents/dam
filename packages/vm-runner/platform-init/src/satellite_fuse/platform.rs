// UNIT_BOUNDARY_DESCRIPTION: how the mount talks to the platform: one GET for the grant list and one POST per file operation, both outbound HTTP through the machine's gateway, under the Agent's own path and with no credential of its own. It is a client of plain HTTP rather than HTTPS on purpose — the gateway is reached by an IP literal, so nothing here resolves a name, and a static binary that called getaddrinfo would resolve it against the image's resolver rather than the platform's. The proxy is set from the launch environment instead of being read by the library, for the same reason.
use std::time::{Duration, Instant};

use super::wire::{Answer, Failure, Grant, GrantList, Refusal, Request};

// UNIT_BOUNDARY_DESCRIPTION: how long one operation may wait on the platform, retries included. The api-server drops an operation that waited 30 s for a worker, so an answer that has not come by then cannot come, and the mount answers EIO instead of holding the Agent's command open.
pub const OP_TIMEOUT: Duration = Duration::from_secs(35);

// UNIT_BOUNDARY_DESCRIPTION: how long one operation waits before it is sent again, and how much of the deadline has to be left for another try to be worth it. A refused read is retried over the whole deadline, because a rolling api-server deploy refuses one for a moment; nothing that changes a file is retried, since a second attempt could apply a write twice.
const RETRY_PAUSE: Duration = Duration::from_millis(250);

#[derive(Debug)]
pub enum GrantsError {
    NotServed,
    Failed(String),
}

// UNIT_BOUNDARY_DESCRIPTION: a Satellite's name as a path segment. The platform's names are already lowercase letters, digits and `.@-`, so this changes nothing for them; it is here so that a name the platform ever widens cannot turn into another route or another Satellite's, which is the same reason the mount checks it before using it as a directory name.
fn encode(name: &str) -> String {
    let mut encoded = String::with_capacity(name.len());
    for byte in name.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'@') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

pub struct Client {
    http: reqwest::blocking::Client,
    base: String,
}

impl Client {
    pub fn new(api_server: &str, proxy: Option<&str>) -> Result<Self, String> {
        let builder = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(OP_TIMEOUT);
        let builder = match proxy {
            Some(proxy) => builder
                .proxy(reqwest::Proxy::http(proxy).map_err(|e| format!("proxy {proxy}: {e}"))?),
            None => builder.no_proxy(),
        };
        let http = builder.build().map_err(|e| format!("http client: {e}"))?;
        Ok(Self {
            http,
            base: api_server.trim_end_matches('/').to_string(),
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: the grants the Agent holds, and the call that is also what the platform counts the mount as present by. A platform older than the channel answers 404, which is not a failure of the machine: the mount stays and asks again later. A name the mount could not show as a directory is dropped here, and a name granted twice reads once, because one directory cannot stand for both.
    pub fn grants(&self, agent: &str, wait: Duration) -> Result<Vec<Grant>, GrantsError> {
        let response = self
            .http
            .get(self.base_url(agent))
            .timeout(wait)
            .send()
            .map_err(|e| GrantsError::Failed(e.to_string()))?;
        if response.status().as_u16() == 404 {
            return Err(GrantsError::NotServed);
        }
        if !response.status().is_success() {
            return Err(GrantsError::Failed(format!(
                "the platform answered {}",
                response.status()
            )));
        }
        let text = response
            .text()
            .map_err(|e| GrantsError::Failed(e.to_string()))?;
        let list: GrantList = serde_json::from_str(&text)
            .map_err(|e| GrantsError::Failed(format!("grant list: {e}")))?;
        let mut seen = std::collections::HashSet::new();
        Ok(list
            .satellites
            .into_iter()
            .filter(|grant| super::wire::name_is_valid(&grant.name))
            .filter(|grant| seen.insert(grant.name.clone()))
            .collect())
    }

    // UNIT_BOUNDARY_DESCRIPTION: one operation's answer, or the errno the Agent's command gets instead. A read-only operation is sent again while the deadline holds when the platform could not be reached or answered 502 or 503, which is how one replica of a rolling deploy refusing a request does not fail a read that the next one would serve; a mutation is answered to the first attempt alone.
    pub fn op(
        &self,
        agent: &str,
        satellite: &str,
        request: &Request,
        read_only: bool,
    ) -> Result<Answer, Failure> {
        let url = self.op_url(agent, satellite);
        let body = serde_json::to_vec(request).map_err(|_| Failure::Io)?;
        let deadline = Instant::now() + OP_TIMEOUT;
        let mut last = Failure::Io;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left < RETRY_PAUSE {
                return Err(last);
            }
            match self.attempt(&url, &body, left.min(OP_TIMEOUT)) {
                Ok(answer) => return Ok(answer),
                Err((failure, again)) => {
                    if !read_only || !again {
                        return Err(failure);
                    }
                    last = failure;
                    std::thread::sleep(RETRY_PAUSE);
                }
            }
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: one attempt, and whether it is worth another: an answer the api-server gave, or the failure it named in its body — which it does whatever the status, so 403 EACCES and 503 EHOSTDOWN are read rather than inferred. Only a refusal with no errno in it, and a request that never arrived, could be the work of something in front of the route — a proxy, an ingress, a replica of a rolling deploy — so those are what a read-only operation is sent again for; a body that names EHOSTDOWN is the platform's answer and is returned at once, which is what keeps a machine that just went quiet saying so without a deadline's wait.
    fn attempt(&self, url: &str, body: &[u8], wait: Duration) -> Result<Answer, (Failure, bool)> {
        let sent = self
            .http
            .post(url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .timeout(wait)
            .body(body.to_vec())
            .send();
        let response = match sent {
            Ok(response) => response,
            Err(_) => return Err((Failure::Io, true)),
        };
        let status = response.status().as_u16();
        let text = response.text().unwrap_or_default();
        if status == 200 {
            return serde_json::from_str(&text).map_err(|_| (Failure::Io, false));
        }
        match serde_json::from_str::<Refusal>(&text) {
            Ok(refusal) if refusal.errno.is_some() => {
                Err((Failure::named(refusal.errno.as_deref()), false))
            }
            _ => Err((Failure::status(status), status == 502 || status == 503)),
        }
    }

    fn base_url(&self, agent: &str) -> String {
        format!("{}/api/agents/{agent}/satellite-files", self.base)
    }

    fn op_url(&self, agent: &str, satellite: &str) -> String {
        format!("{}/{}/op", self.base_url(agent), encode(satellite))
    }
}
