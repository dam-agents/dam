use std::collections::BTreeSet;
use std::time::Duration;

use crate::imagecache::ImageCache;
use crate::launch::read_launch;
use crate::pullauth::PullSecrets;
use crate::state::is_image_ref;

// UNIT_BOUNDARY_DESCRIPTION: the per-node service that fills a node's image cache before any runner needs it. A runner exists only once one of its owner's agents needs one, so without this the first machine on every image, on every node, after every deploy, waits out the fetch with a user on the other end. It is a process on the cache with no machines: it holds nothing but its pins, which are the harness images the install ships, and it claims them the way a runner claims its machines' images — which is what keeps eviction from taking an image nobody is running yet, since it is held by nobody and is the oldest write.
pub struct Preloader {
    pub cache: ImageCache,
    pub every: Duration,
    // UNIT_BOUNDARY_DESCRIPTION: the install's default pull Secrets to fetch with. They are read again on every pass, so a rotated Secret is used without a restart. None fetches anonymously.
    pub pull_secrets: Option<PullSecrets>,
}

impl Preloader {
    // UNIT_BOUNDARY_DESCRIPTION: one pass. Claims are published before anything is fetched and again after each fetch, because a pass can outlast the window a runner believes a claim for, and a claim written only at the start would go stale while the pass that wrote it was still running. The directory is swept every pass, not only after a fetch: runners tidy it only as a side effect of a miss, and a node whose images are all cached would otherwise never reclaim what a departed owner left.
    pub fn sweep(&self, auth: &str) {
        let none = BTreeSet::new();
        self.cache.publish(&none);
        for reference in &self.cache.pinned {
            if self.cache.lifetime.is_cancelled() {
                return;
            }
            if !is_image_ref(reference) || reference.contains("..") {
                tracing::warn!(
                    reason = "the reference is not one a cache entry can be named after",
                    "image cache: this install names an image the preloader will not fetch"
                );
                continue;
            }
            if matches!(read_launch(&self.cache.entry(reference)), Ok(Some(_))) {
                continue;
            }
            if let Err(e) = self.cache.fetch(reference, auth, &none, &none) {
                tracing::warn!(image = %reference, error = %format!("{e:#}"), "image cache: preloading an image this install ships");
            }
            self.cache.publish(&none);
        }
        self.cache.evict(&none, None);
    }

    // UNIT_BOUNDARY_DESCRIPTION: passes until the service is told to stop. The interval bounds the gap between passes, and is also how long a registry that was down is waited out.
    pub async fn run(self) {
        let this = std::sync::Arc::new(self);
        loop {
            let auth = match &this.pull_secrets {
                Some(secrets) => secrets.resolve().await.unwrap_or_else(|e| {
                    tracing::warn!(error = %format!("{e:#}"), "image cache: reading the install's pull Secrets, fetching anonymously this pass");
                    String::new()
                }),
                None => String::new(),
            };
            let pass = this.clone();
            if tokio::task::spawn_blocking(move || pass.sweep(&auth))
                .await
                .is_err()
            {
                return;
            }
            tokio::select! {
                _ = this.cache.lifetime.cancelled() => return,
                _ = tokio::time::sleep(this.every) => {}
            }
        }
    }
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

// UNIT_BOUNDARY_DESCRIPTION: a Go duration as the chart writes the preload interval — `5m`, `90s`, `1h30m`. Each part is a whole number and a unit of h, m, s or ms.
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
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use tokio_util::sync::CancellationToken;

    // TEST_SCENARIO: the chart hands the budget and the interval over as it writes them. The forms it uses must read as the numbers they mean, and anything else must be refused — a budget read as a smaller number evicts images the node needs, and an interval read as a longer one lets the preloader's claims go stale.
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

    struct Dir(PathBuf);
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    // TEST_SCENARIO: a pass fetches each shipped image the cache lacks, once, and claims it under the service's name so a runner's eviction spares it; a second pass over a warm cache fetches nothing.
    #[test]
    fn a_pass_fetches_what_is_missing_and_claims_it() {
        let dir =
            Dir(std::env::temp_dir().join(format!("vm-runner-preload-{}", std::process::id())));
        let _ = fs::remove_dir_all(&dir.0);
        fs::create_dir_all(&dir.0).unwrap();
        let crane = dir.0.join("crane");
        fs::write(
            &crane,
            format!(
                "#!/bin/sh\necho \"$@\" >> {}/crane.log\nif [ \"$1\" = config ]; then printf '{{\"config\":{{\"Cmd\":[\"serve\"]}}}}'; exit 0; fi\nd=$(mktemp -d); echo x > \"$d/f\"; tar -cf - -C \"$d\" .; rm -rf \"$d\"\n",
                dir.0.display()
            ),
        )
        .unwrap();
        fs::set_permissions(&crane, fs::Permissions::from_mode(0o755)).unwrap();
        let preloader = Preloader {
            cache: ImageCache {
                dir: dir.0.join("images"),
                owner: "cache-node-a".into(),
                budget: 1 << 40,
                crane: crane.to_string_lossy().into_owned(),
                pinned: vec!["quay.io/x/claude-code:1".into(), "../bad".into()],
                lifetime: CancellationToken::new(),
            },
            every: Duration::from_secs(60),
            pull_secrets: None,
        };
        preloader.sweep("");
        let entry = preloader.cache.entry("quay.io/x/claude-code:1");
        assert!(read_launch(&entry).unwrap().is_some());
        let claims = fs::read_to_string(dir.0.join("images/.holders/cache-node-a")).unwrap();
        assert!(
            claims
                .lines()
                .any(|l| l == entry.file_name().unwrap().to_str().unwrap()),
            "{claims}"
        );
        let fetches = || {
            fs::read_to_string(dir.0.join("crane.log"))
                .unwrap()
                .lines()
                .count()
        };
        let first = fetches();
        preloader.sweep("");
        assert_eq!(fetches(), first, "a warm cache was fetched again");
    }
}
