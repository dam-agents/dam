use std::path::PathBuf;

use clap::Parser;
use ipnet::IpNet;

// UNIT_BOUNDARY_DESCRIPTION: every flag the Go runner this replaces defines, kept name-for-name, with one deliberate exception below. The controller builds these args itself in packages/controller/pkg/reconciler/vm_runner.go — not the Helm chart — and it passes a subset: state-dir, image-dir, runner-id, image-budget-bytes, memory-mib, reserve-mib, tls-cert, tls-key and allow-from. The rest are defaults the pod never overrides. A rename is therefore not a build failure on either side: it is a runner that rejects an argument its own Deployment sets, which surfaces as a pod that will not start.
// UNIT_BOUNDARY_DESCRIPTION: --smolvm is the exception, and is gone. It named the CLI binary to fork; this runner drives smolvm as a library, so there is no binary to point at and a path here would configure nothing. Dropping a flag is only safe because the controller does not pass this one — it never has — so no Deployment sets an argument this binary would now reject.
#[derive(Parser, Debug)]
#[command(name = "vm-runner", about = "Hosts vm-backend agents as microVMs")]
struct Args {
    #[arg(long, default_value = ":4600")]
    listen: String,
    // UNIT_BOUNDARY_DESCRIPTION: per-machine state: published port, applied spec, and the share each guest reads its CA and platform-init from.
    #[arg(long = "state-dir", default_value = "/var/lib/platform/machines")]
    state_dir: PathBuf,
    // UNIT_BOUNDARY_DESCRIPTION: unpacked agent images and local archives, shared by every runner on this node when the install gives them a host directory.
    #[arg(long = "image-dir", default_value = "/var/lib/platform/images")]
    image_dir: PathBuf,
    // UNIT_BOUNDARY_DESCRIPTION: this runner's name among the runners sharing the image directory; empty keeps the cache private to this runner.
    #[arg(long = "runner-id", default_value = "")]
    runner_id: String,
    // UNIT_BOUNDARY_DESCRIPTION: bytes the cached images may occupy; 0 evicts nothing, and the controller refuses to start a runner without a positive budget.
    #[arg(long = "image-budget-bytes", default_value_t = 0)]
    image_budget_bytes: i64,
    // UNIT_BOUNDARY_DESCRIPTION: crane fetches an agent image the shared cache does not hold; empty disables the fetch.
    #[arg(long, default_value = "crane")]
    crane: String,
    // UNIT_BOUNDARY_DESCRIPTION: platform-init is copied into every machine's share and run as its entrypoint. It is the Go binary that mounts the agent's home inside the guest, which is why this runner being Rust does not move it.
    #[arg(
        long = "platform-init",
        default_value = "/usr/local/libexec/platform-init"
    )]
    platform_init: PathBuf,
    #[arg(long = "port-min", default_value_t = 31000)]
    port_min: u16,
    #[arg(long = "port-max", default_value_t = 31099)]
    port_max: u16,
    // UNIT_BOUNDARY_DESCRIPTION: memory the runner may commit to machines. Required: without it the runner admits machines against no limit at all.
    #[arg(long = "memory-mib", default_value_t = 0)]
    memory_mib: i64,
    #[arg(long = "reserve-mib", default_value_t = 512)]
    reserve_mib: i64,
    #[arg(long = "token-file", default_value = "/etc/vm-runner/token")]
    token_file: PathBuf,
    #[arg(long = "tls-cert", default_value = "")]
    tls_cert: String,
    #[arg(long = "tls-key", default_value = "")]
    tls_key: String,
    // UNIT_BOUNDARY_DESCRIPTION: CIDRs allowed to dial published machine ports; empty admits any. Parsed at startup rather than at first use, because the failure of an allowlist is that it admits everybody, and a runner that took a malformed entry would report nothing wrong while doing exactly that.
    #[arg(long = "allow-from", default_value = "", value_parser = allow_from)]
    allow_from: AllowFrom,
}

// UNIT_BOUNDARY_DESCRIPTION: the whole list as one flag value, which is what it is — a newtype rather than a bare Vec because clap reads a Vec field as "one of these per occurrence" and would hand the parser a single entry while expecting a single entry back. Declared as a Vec it builds, rejects a malformed CIDR correctly, and then panics on the success path downcasting what it parsed.
#[derive(Clone, Debug, Default)]
struct AllowFrom(Vec<IpNet>);

// UNIT_BOUNDARY_DESCRIPTION: the Go runner splits this flag on commas, skips blank entries and exits on anything net.ParseCIDR rejects. Same three rules here, so an install's value means what it meant before.
fn allow_from(value: &str) -> anyhow::Result<AllowFrom> {
    value
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(|entry| {
            entry
                .parse::<IpNet>()
                .map_err(|e| anyhow::anyhow!("--allow-from {entry}: {e}"))
        })
        .collect::<anyhow::Result<Vec<IpNet>>>()
        .map(AllowFrom)
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().json().init();
    let args = Args::parse();
    anyhow::ensure!(
        args.memory_mib > 0,
        "--memory-mib is required: without it the runner admits machines against no limit at all"
    );
    let token = std::fs::read_to_string(&args.token_file)
        .map_err(|e| anyhow::anyhow!("reading {}: {e}", args.token_file.display()))?;
    anyhow::ensure!(!token.trim().is_empty(), "the token file is empty");

    // UNIT_BOUNDARY_DESCRIPTION: the Go runner logs its resolved configuration as it begins serving, which is how an install tells a runner that read its flags from one that fell back to defaults. This one has read and validated the same flags, so it says that and no more — claiming to serve is the one thing this binary must not log.
    tracing::info!(
        listen = %args.listen,
        state_dir = %args.state_dir.display(),
        image_dir = %args.image_dir.display(),
        runner_id = %args.runner_id,
        tls = !args.tls_cert.is_empty(),
        allow_from = args.allow_from.0.len(),
        "vm-runner configuration accepted"
    );
    anyhow::bail!("the machine API is not served yet: this binary is the scaffold for the Rust runner, not the runner")
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEST_SCENARIO: an allowlist fails open — a value it cannot read admits everybody rather than nobody, and says nothing. So each of the Go runner's three rules is pinned: entries split on commas, surrounding space ignored, blanks skipped, and anything that is not a CIDR refused before the runner starts rather than ignored while it runs.
    #[test]
    fn the_allowlist_reads_every_shape_the_go_runner_accepts_and_no_others() {
        assert_eq!(allow_from("").unwrap().0, vec![]);
        assert_eq!(allow_from(" , ").unwrap().0, vec![]);
        assert_eq!(
            allow_from("10.0.0.0/8, 192.168.1.0/24").unwrap().0,
            vec![
                "10.0.0.0/8".parse::<IpNet>().unwrap(),
                "192.168.1.0/24".parse().unwrap()
            ]
        );
        assert_eq!(
            allow_from("fd00::/8").unwrap().0,
            vec!["fd00::/8".parse::<IpNet>().unwrap()]
        );

        let err = allow_from("10.0.0.0/8,not-a-cidr").unwrap_err().to_string();
        assert!(
            err.contains("not-a-cidr"),
            "the refusal has to name the entry: {err}"
        );
    }

    // TEST_SCENARIO: clap reads a Vec field as one value per occurrence, so a parser that returns the whole list against a Vec field builds, refuses a bad CIDR correctly, and then panics downcasting a good one. Parsing the flag through the real Args is what tells the two apart — the unit test above passes either way.
    #[test]
    fn a_parsed_allowlist_survives_being_read_back_off_the_args() {
        let args = Args::try_parse_from([
            "vm-runner",
            "--memory-mib=1",
            "--allow-from=10.0.0.0/8,192.168.1.0/24",
        ])
        .expect("these are the flags the controller passes");
        assert_eq!(args.allow_from.0.len(), 2);
        assert!(Args::try_parse_from(["vm-runner", "--allow-from=nope"]).is_err());
    }
}
