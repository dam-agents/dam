use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{Map, Value};
use tokio_util::sync::CancellationToken;

use crate::imagecache::ImageCache;

// UNIT_BOUNDARY_DESCRIPTION: the node service's preload loop. A runner exists only once one of its owner's agents needs one, so without this the first machine on every harness image, on every node, after every deploy, waits out the fetch with a user on the other end. Each pass reads the install's default pull Secrets from their mounted volume again, so a rotated Secret is used without a restart.
pub async fn run(
    cache: Arc<ImageCache>,
    every: Duration,
    secrets: Option<PathBuf>,
    lifetime: CancellationToken,
) {
    loop {
        let auths = secrets
            .as_deref()
            .map(read_pull_secrets)
            .unwrap_or_default();
        let pass = cache.clone();
        if tokio::task::spawn_blocking(move || pass.preload(&auths))
            .await
            .is_err()
        {
            return;
        }
        tokio::select! {
            _ = lifetime.cancelled() => return,
            _ = tokio::time::sleep(every) => {}
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the docker configs to preload with, one per mounted pull Secret, in the order the install lists them. The kubelet tries each Secret in turn, so they are kept apart rather than merged, and a stale credential for a registry does not hide a good one listed after it. The chart projects Secret number N into the directory `N`, zero-padded so the names sort in order, under the key it was written with: `.dockerconfigjson`, a whole config with its registries under `auths`, or the older `.dockercfg`, which is the registries alone. A Secret that is missing or names no registry adds nothing. The kubelet's own dot-named links are skipped. The documents hold credentials, so none is logged.
pub fn read_pull_secrets(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| !name.starts_with('.'))
        .collect();
    names.sort();
    names
        .iter()
        .filter_map(|name| {
            let secret = dir.join(name);
            let read = |key: &str| -> Option<Value> {
                serde_json::from_slice(&fs::read(secret.join(key)).ok()?).ok()
            };
            let auths: Option<Map<String, Value>> = match read(".dockerconfigjson") {
                Some(config) => match config.get("auths") {
                    Some(Value::Object(auths)) => Some(auths.clone()),
                    _ => None,
                },
                None => match read(".dockercfg") {
                    Some(Value::Object(auths)) => Some(auths),
                    _ => None,
                },
            };
            auths
                .filter(|auths| !auths.is_empty())
                .map(|auths| serde_json::json!({ "auths": auths }).to_string())
        })
        .collect()
}

// UNIT_BOUNDARY_DESCRIPTION: a Kubernetes quantity as the chart writes the cache budget — `50Gi`, `500M`, or plain bytes — as a byte count. Only the suffixes a size is written with are read; anything else is refused rather than read as some other number.
pub fn parse_quantity(text: &str) -> anyhow::Result<i64> {
    let text = text.trim();
    let split = text
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(text.len());
    let (digits, suffix) = text.split_at(split);
    let count: i64 = digits
        .parse()
        .map_err(|_| anyhow::anyhow!("{text:?} is not a quantity"))?;
    let unit: i64 = match suffix {
        "" => 1,
        "Ki" => 1 << 10,
        "Mi" => 1 << 20,
        "Gi" => 1 << 30,
        "Ti" => 1 << 40,
        "Pi" => 1 << 50,
        "k" => 1_000,
        "M" => 1_000_000,
        "G" => 1_000_000_000,
        "T" => 1_000_000_000_000,
        "P" => 1_000_000_000_000_000,
        _ => anyhow::bail!("{text:?} is not a quantity"),
    };
    count
        .checked_mul(unit)
        .ok_or_else(|| anyhow::anyhow!("{text:?} is too large"))
}

// UNIT_BOUNDARY_DESCRIPTION: a duration in the form the chart writes the preload interval — `5m`, `90s`, `1h30m`. Each part is a whole number and a unit of h, m, s or ms.
pub fn parse_duration(text: &str) -> anyhow::Result<Duration> {
    let mut rest = text.trim();
    anyhow::ensure!(!rest.is_empty(), "an empty duration");
    let mut total = Duration::ZERO;
    while !rest.is_empty() {
        let split = rest
            .find(|c: char| !c.is_ascii_digit())
            .ok_or_else(|| anyhow::anyhow!("{text:?} is missing a unit"))?;
        let (digits, after) = rest.split_at(split);
        let count: u64 = digits
            .parse()
            .map_err(|_| anyhow::anyhow!("{text:?} is not a duration"))?;
        let (unit, remaining) = if let Some(r) = after.strip_prefix("ms") {
            (Duration::from_millis(1), r)
        } else if let Some(r) = after.strip_prefix('h') {
            (Duration::from_secs(3600), r)
        } else if let Some(r) = after.strip_prefix('m') {
            (Duration::from_secs(60), r)
        } else if let Some(r) = after.strip_prefix('s') {
            (Duration::from_secs(1), r)
        } else {
            anyhow::bail!("{text:?} is not a duration");
        };
        total += unit * u32::try_from(count)?;
        rest = remaining;
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEST_SCENARIO: the chart hands the budget and the interval over as it writes them. The forms it uses must read as the numbers they mean, and anything else must be refused — a budget read as a smaller number evicts images the node needs.
    #[test]
    fn the_charts_budget_and_interval_read_as_what_they_mean() {
        assert_eq!(parse_quantity("50Gi").unwrap(), 50 << 30);
        assert_eq!(parse_quantity("500M").unwrap(), 500_000_000);
        assert_eq!(parse_quantity("1024").unwrap(), 1024);
        assert!(parse_quantity("50GB").is_err());
        assert!(parse_quantity("Gi").is_err());
        assert_eq!(parse_duration("5m").unwrap(), Duration::from_secs(300));
        assert_eq!(parse_duration("1h30m").unwrap(), Duration::from_secs(5400));
        assert_eq!(parse_duration("250ms").unwrap(), Duration::from_millis(250));
        assert!(parse_duration("5").is_err());
        assert!(parse_duration("5d").is_err());
        assert!(parse_duration("").is_err());
    }

    // TEST_SCENARIO: the chart mounts each default pull Secret under its place in the install's list. Both keys a pull Secret is written under are read, the Secrets are kept apart in list order rather than merged, and a Secret with no registry in it, or with nothing mounted, adds nothing — so a pass with nothing to fetch with is anonymous rather than one with an empty config.
    #[test]
    fn each_mounted_secret_keeps_its_own_registries_in_list_order() {
        let dir =
            std::env::temp_dir().join(format!("vm-runner-pull-secrets-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let write = |name: &str, key: &str, body: &str| {
            fs::create_dir_all(dir.join(name)).unwrap();
            fs::write(dir.join(name).join(key), body).unwrap();
        };
        write("001", ".dockercfg", r#"{"ghcr.io":{"auth":"c2Vjb25k"}}"#);
        write(
            "000",
            ".dockerconfigjson",
            r#"{"auths":{"quay.io":{"auth":"Zmlyc3Q="}}}"#,
        );
        write("002", ".dockerconfigjson", "{}");
        write("003", ".dockerconfigjson", "not json");
        fs::create_dir_all(dir.join("004")).unwrap();
        write(".hidden", ".dockercfg", r#"{"docker.io":{"auth":"eA=="}}"#);

        let docs = read_pull_secrets(&dir);

        assert_eq!(
            docs,
            [
                r#"{"auths":{"quay.io":{"auth":"Zmlyc3Q="}}}"#,
                r#"{"auths":{"ghcr.io":{"auth":"c2Vjb25k"}}}"#,
            ]
        );
        assert!(read_pull_secrets(&dir.join("missing")).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
