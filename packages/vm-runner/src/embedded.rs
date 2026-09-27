use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::Context;
use smolvm::agent::{
    state_probe, vm_data_dir, AgentClient, AgentManager, HostMount, PortMapping, VmResources,
};
use smolvm::config::{RecordState, VmRecord};
use smolvm::data::image_source::{classify, packed_layers_dir_for_ref, resolve, ResolvedImage};
use smolvm::db::SmolvmDb;
use smolvm::embedded::{EmbeddedRuntime, MachineSpec as SmolvmSpec};
use smolvm::network::NetworkBackend;
use smolvm::storage::{expand_disk, Storage, StorageDisk, STORAGE_DISK_FILENAME};

use crate::api::{MachineSpec, State};
use crate::console;
use crate::guest::SHARE_PATH;
use crate::runtime::{
    clear_for_start, discard_overlay, grown_storage, image_env_beside, kill_orphans, orphan_pids,
    timed, updated_env, vmm_gone, workload, Machine, Runtime, Update, GUEST_AGENT_PORT,
    VMM_EXIT_WAIT,
};

// UNIT_BOUNDARY_DESCRIPTION: the runtime backed by smolvm's embedding API. It keeps smolvm's own state — the machine database and the machine directories — where smolvm keeps it by default, under the runner's HOME, which is the runner's claim. Each call is synchronous and may block for as long as a boot takes, so the server runs them off its async threads.
pub struct Smolvm {
    runtime: EmbeddedRuntime,
    db: SmolvmDb,
    proc_root: PathBuf,
}

const USER: &str = "root";

// UNIT_BOUNDARY_DESCRIPTION: where smolvm's gateway forwards a guest's DNS. The gateway answers every guest query on port 53, whatever address it was sent to, by relaying it from the runner's own network to this resolver, and its egress allowlist never gates that relay — so with smolvm's default, the runner's resolver, a guest that holds nothing but its gateway's address could still tunnel data out through DNS. A guest needs no resolver: its proxy and its allowlist are addresses, and every name it asks for travels through that proxy and is resolved by the paired gateway pod. The runner's own loopback has nothing listening on port 53 and never leaves the pod, so every relayed query is refused where it starts.
const GUEST_DNS_SINK: std::net::Ipv4Addr = std::net::Ipv4Addr::LOCALHOST;

// UNIT_BOUNDARY_DESCRIPTION: the label smolvm stores on every machine this runner creates. smolvm never reads it; it is how an operator listing smolvm's machines tells the runner's own from anything else in the same database.
const MANAGED_BY: (&str, &str) = ("app.kubernetes.io/managed-by", "vm-runner");

impl Smolvm {
    pub fn open() -> anyhow::Result<Self> {
        Ok(Self {
            runtime: EmbeddedRuntime::new().context("opening the smolvm runtime")?,
            db: SmolvmDb::open().context("opening the smolvm database")?,
            proc_root: PathBuf::from("/proc"),
        })
    }

    fn record(&self, id: &str) -> anyhow::Result<Option<VmRecord>> {
        Ok(self.db.get_vm(id)?)
    }

    fn existing(&self, id: &str) -> anyhow::Result<VmRecord> {
        self.record(id)?
            .ok_or_else(|| anyhow::anyhow!("machine '{id}' not found"))
    }

    // UNIT_BOUNDARY_DESCRIPTION: runs a smolvm stop or delete, and powers the machine off when smolvm refuses it. smolvm stops a running guest only once the guest confirms its disks are quiesced, and when the guest does not confirm, it leaves the VMM running and fails the call. The runner still has to end the machine: the controller asked for the stop, a restart cannot apply a change without it, and a delete of a machine that never confirms would never finish. So a refusal while a VMM still holds the machine's directory kills that VMM, which is what a stop did before smolvm asked for the confirmation, and the call is made once more, against a machine that is now down.
    fn ended(&self, id: &str, end: impl Fn() -> smolvm::Result<()>) -> anyhow::Result<()> {
        let Err(refused) = end() else {
            return Ok(());
        };
        let dir = vm_data_dir(id);
        if orphan_pids(&self.proc_root, &dir).is_empty() {
            return Err(refused.into());
        }
        tracing::warn!(machine = id, error = %refused, "the guest did not stop cleanly; powering it off");
        kill_orphans(&self.proc_root, &dir);
        vmm_gone(&self.proc_root, &dir, VMM_EXIT_WAIT);
        Ok(end()?)
    }
}

impl Runtime for Smolvm {
    // UNIT_BOUNDARY_DESCRIPTION: read from the record and the VMM process. smolvm resolves a live VMM whose guest agent missed one vsock ping, with a three-second timeout, as unreachable, and that is what a busy guest looks like as well as a dead agent. It reads as running here: the machine is up and holds its memory, and whether it serves is the health prober's to judge, so a guest that stays quiet is restarted after the unhealthy grace, and counted, rather than rebooted on the first missed ping. Only a VMM that is gone reads as stopped.
    fn state(&self, id: &str) -> anyhow::Result<State> {
        Ok(match self.record(id)? {
            None => State::Absent,
            Some(record) => match state_probe::resolve_state(id, &record) {
                RecordState::Running | RecordState::Unreachable => State::Running,
                _ => State::Stopped,
            },
        })
    }

    fn create(&self, id: &str, machine: &Machine<'_>) -> anyhow::Result<()> {
        let secrets: Vec<&str> = machine.spec.env.values().map(String::as_str).collect();
        timed("create", id, &secrets, || {
            let (spec, workload) = embedded_spec(id, machine)?;
            let storage_gib = spec.resources.storage_gib;
            self.runtime.create_machine_with_workload(
                spec,
                workload.env,
                workload.workdir,
                Some(USER.to_string()),
            )?;
            if let Some(gib) = storage_gib {
                raw_storage_disk(id, gib)?;
            }
            self.db.update_vm(id, |r| r.dns = Some(GUEST_DNS_SINK))?;
            Ok(())
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: applies a new shape to a machine that is not running. A record can still say running while its VMM lives on after a stop that did not finish, and smolvm refuses to update a running record — so that VMM is taken down first, as a start would, and waited out before the record is read again, since the record reads stopped only once the process is gone. Everything smolvm boots from is read out of the record at each start: the image and the command, workdir and env it launches, and the allowlist the VMM enforces. So a new image or allowlist is only a record write here, and the storage disk and published port are untouched. A new image is safe to take this way because platform-init boots every image on a fresh root: the root smolvm keeps on the disk for this machine, with the old image's changes in it, is never the one the new image runs on.
    fn update(&self, id: &str, update: &Update<'_>) -> anyhow::Result<()> {
        let Update {
            desired,
            applied,
            image,
        } = *update;
        let secrets: Vec<&str> = desired.env.values().map(String::as_str).collect();
        timed("update", id, &secrets, || {
            let mut record = self.existing(id)?;
            if record.actual_state() == RecordState::Running
                && state_probe::resolve_state(id, &record) != RecordState::Running
            {
                let _ = self.runtime.stop_machine(id);
                let dir = vm_data_dir(id);
                kill_orphans(&self.proc_root, &dir);
                vmm_gone(&self.proc_root, &dir, VMM_EXIT_WAIT);
                record = self.existing(id)?;
            }
            if !matches!(
                record.actual_state(),
                RecordState::Stopped | RecordState::Created
            ) {
                anyhow::bail!("machine '{id}' must be stopped to update it");
            }
            let cpus = u8::try_from(desired.cpus).context("cpus")?;
            let mem = u32::try_from(desired.memory_mib).context("memoryMiB")?;
            VmResources {
                cpus,
                memory_mib: mem,
                ..record.vm_resources()
            }
            .validate()?;
            let disk = storage_disk_path(id);
            let grown = match std::fs::metadata(&disk) {
                Ok(on_disk) => grown_storage(on_disk.len(), desired),
                Err(_) => grown_storage(record.storage_gb.unwrap_or(0) << 30, desired),
            };
            if let Some(gib) = grown {
                if disk.exists() {
                    expand_disk::<Storage>(&disk, gib)?;
                }
            }
            let allowed_cidrs = allowed_cidrs(desired)?;
            let image_env = record
                .image
                .as_deref()
                .and_then(packed_layers_dir_for_ref)
                .and_then(|rootfs| image_env_beside(&rootfs));
            let relaunch = image
                .map(|(image, launch)| {
                    anyhow::Ok((resolved_image(image)?, workload(desired, launch)?))
                })
                .transpose()?;
            self.db.update_vm(id, |r| {
                r.cpus = cpus;
                r.mem = mem;
                if let Some(gib) = grown {
                    r.storage_gb = Some(gib);
                }
                r.allowed_cidrs = allowed_cidrs;
                match relaunch {
                    Some((image, workload)) => {
                        r.image = Some(image);
                        r.entrypoint = Vec::new();
                        r.cmd = workload.command;
                        r.workdir = workload.workdir;
                        r.env = workload.env;
                    }
                    None => r.env = updated_env(&r.env, applied, desired, image_env.as_deref()),
                }
            })?;
            Ok(())
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: a start is always a fresh boot. Whatever the last VMM left is cleared first — a stop issued to a machine that died with its runner, a VMM that outlived its stop, its sockets and lock files, the guest agent's root overlay — and a start that fails kills any VMM it left half-booted, so the next attempt does not inherit it. A VMM that survives even its kill fails the start, since booting beside it would put two VMMs on one disk. The record's resolver is pinned to the sink on every start, so a machine created by an earlier runner boots with it too.
    fn start(&self, id: &str) -> anyhow::Result<()> {
        let dir = vm_data_dir(id);
        if dir.is_dir() {
            let _ = self.runtime.stop_machine(id);
            clear_for_start(id, &self.proc_root, &dir, VMM_EXIT_WAIT)
                .map_err(|e| anyhow::anyhow!("smolvm machine start: {e:#}"))?;
        }
        self.db.update_vm(id, |r| r.dns = Some(GUEST_DNS_SINK))?;
        let result = timed("start", id, &[], || Ok(self.runtime.start_machine(id)?));
        if result.is_err() {
            kill_orphans(&self.proc_root, &dir);
        }
        result
    }

    fn stop(&self, id: &str) -> anyhow::Result<()> {
        terminate_workload(id);
        timed("stop", id, &[], || {
            self.ended(id, || self.runtime.stop_machine(id))
        })?;
        discard_overlay(id, &self.proc_root, &vm_data_dir(id));
        Ok(())
    }

    fn delete(&self, id: &str) -> anyhow::Result<()> {
        timed("delete", id, &[], || {
            self.ended(id, || self.runtime.delete_machine(id))
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: a `local-dir:` or `local:` reference is mapped back to its host directory the way a start maps it, so this answers exactly what that start would find.
    fn image_present(&self, id: &str) -> anyhow::Result<bool> {
        Ok(self
            .existing(id)?
            .image
            .as_deref()
            .and_then(packed_layers_dir_for_ref)
            .is_none_or(|dir| dir.is_dir()))
    }

    fn console_tail(&self, id: &str) -> String {
        console::tail_of(
            &vm_data_dir(id).join(console::CONSOLE_LOG),
            console::CONSOLE_TAIL_BYTES,
        )
    }
}

// UNIT_BOUNDARY_DESCRIPTION: how long a stop gives the guest's workload to exit on SIGTERM before the guest is frozen and powered off. smolvm's own stop only quiesces the disks and kills the VMM, so without this the agent never hears it is being stopped, and what it has not yet written is lost with it.
pub const WORKLOAD_TERM_GRACE: Duration = Duration::from_secs(5);

// UNIT_BOUNDARY_DESCRIPTION: the guest agent runs the workload as a crun container under this root and binary, as the pinned smolvm release lays out its agent root filesystem. They are not smolvm library API, so a smolvm upgrade that moves them makes the SIGTERM a no-op, never a failed stop; the test pins them to be looked at with every bump.
const GUEST_CRUN: &str = "/usr/bin/crun --root /storage/containers/crun";

// UNIT_BOUNDARY_DESCRIPTION: the shell the guest agent runs, in its own root and not the image's, to send SIGTERM to every container it runs — the machine's one workload — and wait up to `grace` for them to stop. Every failure is swallowed: the stop goes on to quiesce and power off either way.
fn workload_term_script(grace: Duration) -> String {
    format!(
        r#"crun="{GUEST_CRUN}"
ids=$($crun list -q 2>/dev/null) || exit 0
[ -n "$ids" ] || exit 0
for id in $ids; do $crun kill "$id" TERM 2>/dev/null; done
end=$(( $(date +%s) + {secs} ))
while [ "$(date +%s)" -lt "$end" ]; do
  up=0
  for id in $ids; do $crun state "$id" 2>/dev/null | grep -q '"status": *"running"' && up=1; done
  [ "$up" = 0 ] && exit 0
  sleep 0.2 2>/dev/null || sleep 1
done
exit 0
"#,
        secs = grace.as_secs()
    )
}

// UNIT_BOUNDARY_DESCRIPTION: asks the guest agent, over its vsock socket, to send the workload SIGTERM and wait for it, as a pod's container gets before its kill. The workload is platform-init exec'd into the image's entrypoint, so the signal reaches what the image runs as its first process. A guest that cannot be reached is not waited on. The manager is detached at once: dropped attached, it would shut the machine down itself.
fn terminate_workload(id: &str) {
    let Ok(manager) = AgentManager::for_vm(id) else {
        return;
    };
    manager.detach();
    let Ok(mut client) = AgentClient::connect_for_state_probe(manager.vsock_socket()) else {
        return;
    };
    let command = vec![
        "/bin/sh".to_string(),
        "-c".to_string(),
        workload_term_script(WORKLOAD_TERM_GRACE),
    ];
    let limit = WORKLOAD_TERM_GRACE + Duration::from_secs(5);
    match client.vm_exec(command, Vec::new(), None, Some(limit), None) {
        Ok((0, _, _)) => {}
        Ok((code, _, _)) => {
            tracing::warn!(
                machine = id,
                code,
                "the workload's SIGTERM did not run cleanly; stopping the guest anyway"
            )
        }
        Err(e) => {
            tracing::warn!(machine = id, error = %e, "the workload could not be sent SIGTERM; stopping the guest anyway")
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the smolvm record for one machine: the image, cpus, memory and storage disk; networking on the virtio-net backend with egress limited to the spec's CIDRs; the agent port published on a loopback port; the share mounted read-only; and the workload platform-init hands off to.
fn embedded_spec(
    id: &str,
    machine: &Machine<'_>,
) -> anyhow::Result<(SmolvmSpec, crate::runtime::Workload)> {
    let spec = machine.spec;
    let workload = workload(spec, machine.launch)?;
    let resources = VmResources {
        cpus: u8::try_from(spec.cpus).context("cpus")?,
        memory_mib: u32::try_from(spec.memory_mib).context("memoryMiB")?,
        network: true,
        network_backend: Some(NetworkBackend::VirtioNet),
        storage_gib: Some(u64::try_from(spec.storage_gib).context("storageGiB")?),
        allowed_cidrs: (!spec.allow_cidrs.is_empty()).then(|| spec.allow_cidrs.clone()),
        ..VmResources::default()
    };
    resources.validate()?;
    let share = machine
        .share
        .canonicalize()
        .with_context(|| format!("the machine share {}", machine.share.display()))?;
    let smolvm_spec = SmolvmSpec {
        name: id.to_string(),
        mounts: vec![HostMount {
            source: share,
            target: PathBuf::from(SHARE_PATH),
            read_only: true,
            staged: false,
        }],
        ports: vec![PortMapping::new(machine.host_port, GUEST_AGENT_PORT)],
        resources,
        image: Some(resolved_image(machine.image)?),
        command: workload.command.clone(),
        persistent: true,
        labels: BTreeMap::from([(MANAGED_BY.0.to_string(), MANAGED_BY.1.to_string())]),
        ..SmolvmSpec::default()
    };
    Ok((smolvm_spec, workload))
}

// UNIT_BOUNDARY_DESCRIPTION: the allowlist as a create records it: none for a spec that names none, and each range in smolvm's own normal form otherwise, so an update writes what a create of the same spec would.
fn allowed_cidrs(spec: &MachineSpec) -> anyhow::Result<Option<Vec<String>>> {
    if spec.allow_cidrs.is_empty() {
        return Ok(None);
    }
    let parsed = spec
        .allow_cidrs
        .iter()
        .map(|cidr| smolvm::smolfile::parse_cidr(cidr))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|reason| anyhow::anyhow!("allowCidrs: {reason}"))?;
    Ok(Some(parsed))
}

// UNIT_BOUNDARY_DESCRIPTION: the image as the record must name it. A directory becomes a `local-dir:` reference smolvm boots in place, which is what lets every machine of an image share one unpacked tree. An archive is staged into smolvm's own cache and named `local:`. A registry reference passes through. The CLI resolves the same way before it writes a record; the embedding API does not, so it is done here.
fn resolved_image(image: &str) -> anyhow::Result<String> {
    Ok(match resolve(classify(image))? {
        ResolvedImage::Registry(reference) => reference,
        ResolvedImage::Local { reference, .. } => reference,
    })
}

// UNIT_BOUNDARY_DESCRIPTION: creates the machine's storage disk as a raw sparse file before its first boot. Left to smolvm, a disk of smolvm's default size is made instead as a qcow2 overlay over the template shipped with the runner image, named by its absolute path in that image — so an upgrade that ships a different template would change the bytes under every such agent's home. A raw disk depends on nothing, and smolvm formats it on first boot as it does any other size.
fn raw_storage_disk(id: &str, gib: u64) -> anyhow::Result<()> {
    StorageDisk::open_or_create_at(&storage_disk_path(id), gib)?;
    Ok(())
}

fn storage_disk_path(id: &str) -> PathBuf {
    vm_data_dir(id).join(STORAGE_DISK_FILENAME)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::launch::ImageLaunch;
    use std::fs;
    use std::sync::Mutex;

    // UNIT_BOUNDARY_DESCRIPTION: smolvm finds its database and machine directories through HOME and the XDG variables, which are process-wide. The tests that open a real runtime take this lock and point both at their own directory, so they cannot see each other's machines.
    static HOME: Mutex<()> = Mutex::new(());

    struct Home {
        path: PathBuf,
        _dir: crate::testdir::TempDir,
        _lock: std::sync::MutexGuard<'static, ()>,
    }

    impl Home {
        fn new(name: &str) -> Self {
            let lock = HOME.lock().unwrap_or_else(|e| e.into_inner());
            let dir = crate::testdir::TempDir::new(&format!("smolvm-{name}"));
            let path = dir.path().to_path_buf();
            std::env::set_var("HOME", &path);
            std::env::set_var("XDG_DATA_HOME", path.join("data"));
            std::env::set_var("XDG_CACHE_HOME", path.join("cache"));
            Self {
                path,
                _dir: dir,
                _lock: lock,
            }
        }
    }

    fn spec() -> MachineSpec {
        MachineSpec {
            image: "quay.io/x/vm:1".into(),
            cpus: 2,
            memory_mib: 2048,
            storage_gib: 20,
            env: [("TOKEN".to_string(), "hunter22".to_string())].into(),
            allow_cidrs: vec!["10.96.0.7/32".into()],
            running: true,
            ..MachineSpec::default()
        }
    }

    fn launch() -> ImageLaunch {
        ImageLaunch {
            entrypoint: vec!["/entry".into()],
            cmd: vec![],
            env: vec!["PATH=/usr/bin".into()],
            working_dir: "/app".into(),
        }
    }

    // TEST_SCENARIO: the record a create writes is the machine: what it boots, how big it is, where it may send traffic, which port it is published on and what it runs. Each field is read back from smolvm's own database rather than from what this code meant to write.
    #[test]
    fn a_created_machine_is_recorded_as_its_spec_says() {
        let home = Home::new("create");
        let share = home.path.join("share");
        let tree = home.path.join("images/quay.io_x_vm_1/rootfs");
        fs::create_dir_all(&share).unwrap();
        fs::create_dir_all(&tree).unwrap();
        let smolvm = Smolvm::open().unwrap();
        let spec = spec();
        let launch = launch();

        smolvm
            .create(
                "m1",
                &Machine {
                    spec: &spec,
                    image: tree.to_str().unwrap(),
                    host_port: 32000,
                    share: &share,
                    launch: &launch,
                },
            )
            .unwrap();

        let record = smolvm
            .db
            .get_vm("m1")
            .unwrap()
            .expect("the machine was recorded");
        assert_eq!(
            record.image.as_deref(),
            Some(format!("local-dir:{}", tree.canonicalize().unwrap().display()).as_str()),
            "an unpacked tree must be booted in place, not staged into a copy"
        );
        assert_eq!(
            (record.cpus, record.mem, record.storage_gb),
            (2, 2048, Some(20))
        );
        assert_eq!(record.ports, vec![(32000, GUEST_AGENT_PORT)]);
        assert_eq!(record.user.as_deref(), Some(USER));
        assert_eq!(record.workdir.as_deref(), Some("/app"));
        assert_eq!(record.cmd, vec![crate::guest::INIT_PATH, "/entry"]);
        assert_eq!(
            record.env,
            vec![
                ("PATH".to_string(), "/usr/bin".to_string()),
                ("TOKEN".to_string(), "hunter22".to_string()),
            ]
        );
        assert_eq!(record.allowed_cidrs, Some(vec!["10.96.0.7/32".to_string()]));
        assert!(record.network);
        assert_eq!(record.network_backend, Some(NetworkBackend::VirtioNet));
        assert_eq!(
            record.mounts,
            vec![(
                share.canonicalize().unwrap().to_string_lossy().into_owned(),
                SHARE_PATH.to_string(),
                true
            )]
        );
        assert!(!record.ephemeral, "a machine must survive a stop");
        assert_eq!(smolvm.state("m1").unwrap(), State::Stopped);
        assert_eq!(
            record.dns,
            Some(GUEST_DNS_SINK),
            "the gateway relays guest DNS past the allowlist, so it must relay it nowhere"
        );
    }

    // TEST_SCENARIO: a machine recorded by an earlier runner carries smolvm's default resolver, which relays the guest's DNS out of the pod. Its next start pins the sink before anything boots, so the record the VMM reads names nowhere — even when, as here, the boot itself then fails.
    #[test]
    fn every_start_relays_guest_dns_nowhere() {
        let home = Home::new("dns");
        let share = home.path.join("share");
        fs::create_dir_all(&share).unwrap();
        let smolvm = Smolvm::open().unwrap();
        let spec = spec();
        let launch = launch();
        smolvm
            .create(
                "m1",
                &Machine {
                    spec: &spec,
                    image: "quay.io/x/vm:1",
                    host_port: 32000,
                    share: &share,
                    launch: &launch,
                },
            )
            .unwrap();
        smolvm.db.update_vm("m1", |r| r.dns = None).unwrap();

        let _ = smolvm.start("m1");

        assert_eq!(
            smolvm.record("m1").unwrap().unwrap().dns,
            Some(GUEST_DNS_SINK)
        );
    }

    // TEST_SCENARIO: a storage disk of smolvm's default size would otherwise be a qcow2 overlay over the template in the runner image, named by its path there — a runner upgrade that ships another template would change the bytes under that agent's home. The create leaves a raw disk behind instead, which smolvm then boots as it is.
    #[test]
    fn a_default_sized_disk_is_raw_and_depends_on_no_template() {
        let home = Home::new("raw");
        let share = home.path.join("share");
        fs::create_dir_all(&share).unwrap();
        let smolvm = Smolvm::open().unwrap();
        let spec = spec();
        let launch = launch();
        smolvm
            .create(
                "m1",
                &Machine {
                    spec: &spec,
                    image: "quay.io/x/vm:1",
                    host_port: 32000,
                    share: &share,
                    launch: &launch,
                },
            )
            .unwrap();

        let disk = storage_disk_path("m1");
        assert!(disk.exists(), "no raw disk was made");
        assert_eq!(fs::metadata(&disk).unwrap().len(), 20 << 30);
        assert!(!vm_data_dir("m1").join("storage.qcow2").exists());
    }

    // TEST_SCENARIO: an update reshapes a stopped machine in place — size, env, and a disk that grows — so the agent keeps its disk across a resize.
    #[test]
    fn an_update_reshapes_the_stopped_machine_and_keeps_its_disk() {
        let home = Home::new("update");
        let share = home.path.join("share");
        fs::create_dir_all(&share).unwrap();
        let smolvm = Smolvm::open().unwrap();
        let applied = spec();
        let launch = launch();
        smolvm
            .create(
                "m1",
                &Machine {
                    spec: &applied,
                    image: "quay.io/x/vm:1",
                    host_port: 32000,
                    share: &share,
                    launch: &launch,
                },
            )
            .unwrap();

        let mut desired = spec();
        desired.cpus = 4;
        desired.memory_mib = 4096;
        desired.storage_gib = 30;
        desired.env = [("NEW".to_string(), "x".to_string())].into();
        smolvm
            .update(
                "m1",
                &Update {
                    desired: &desired,
                    applied: Some(&applied),
                    image: None,
                },
            )
            .unwrap();

        let record = smolvm.db.get_vm("m1").unwrap().unwrap();
        assert_eq!(
            (record.cpus, record.mem, record.storage_gb),
            (4, 4096, Some(30))
        );
        assert_eq!(
            record.env,
            vec![
                ("NEW".to_string(), "x".to_string()),
                ("PATH".to_string(), "/usr/bin".to_string()),
            ]
        );
        assert_eq!(
            fs::metadata(storage_disk_path("m1")).unwrap().len(),
            30 << 30
        );
    }

    // TEST_SCENARIO: the disk is grown from its own size, not from the spec the runner kept: a machine whose stored spec was lost is updated with no applied spec at all, and its disk still grows to the size asked for.
    #[test]
    fn a_disk_grows_to_the_size_asked_even_with_no_applied_spec() {
        let home = Home::new("grow-unknown");
        let share = home.path.join("share");
        fs::create_dir_all(&share).unwrap();
        let smolvm = Smolvm::open().unwrap();
        let created = spec();
        let launch = launch();
        smolvm
            .create(
                "m1",
                &Machine {
                    spec: &created,
                    image: "quay.io/x/vm:1",
                    host_port: 32000,
                    share: &share,
                    launch: &launch,
                },
            )
            .unwrap();

        let mut desired = spec();
        desired.storage_gib = 25;
        smolvm
            .update(
                "m1",
                &Update {
                    desired: &desired,
                    applied: None,
                    image: None,
                },
            )
            .unwrap();
        assert_eq!(
            fs::metadata(storage_disk_path("m1")).unwrap().len(),
            25 << 30
        );
        assert_eq!(smolvm.record("m1").unwrap().unwrap().storage_gb, Some(25));
    }

    // TEST_SCENARIO: a stop sends the workload SIGTERM through the guest agent, in the agent's own root where crun runs it, before smolvm freezes the guest. The crun root and binary are the pinned smolvm release's layout and not its API, so they are pinned here to be checked on every smolvm bump, and the wait is bounded by the grace.
    #[test]
    fn a_stop_signals_the_workload_where_the_guest_agent_runs_it() {
        let script = workload_term_script(WORKLOAD_TERM_GRACE);
        assert!(script.contains(r#"crun="/usr/bin/crun --root /storage/containers/crun""#));
        assert!(script.contains(r#"$crun kill "$id" TERM"#));
        assert!(script.contains("+ 5 ))"), "{script}");
        assert_eq!(WORKLOAD_TERM_GRACE, Duration::from_secs(5));
    }

    // TEST_SCENARIO: a failure's text reaches the Agent's status, and the env it was given holds the Agent's Secret values. Neither may appear in it.
    #[test]
    fn a_failed_create_does_not_repeat_the_agents_secrets() {
        let home = Home::new("redact");
        let smolvm = Smolvm::open().unwrap();
        let mut spec = spec();
        spec.env.insert("TOKEN".into(), "hunter22".into());
        spec.cpus = 0;
        let launch = launch();
        let err = smolvm
            .create(
                "m1",
                &Machine {
                    spec: &spec,
                    image: "quay.io/x/vm:1",
                    host_port: 32000,
                    share: &home.path.join("missing"),
                    launch: &launch,
                },
            )
            .unwrap_err()
            .to_string();
        assert!(err.starts_with("smolvm machine create: "), "{err}");
        assert!(!err.contains("hunter22"), "{err}");
        assert_eq!(smolvm.state("m1").unwrap(), State::Absent);
    }

    // TEST_SCENARIO: a live VMM whose guest agent does not answer its ping is what a busy guest looks like, so it reads as running: the health prober decides whether it is restarted, after the unhealthy grace, and it keeps being counted against the runner's memory. Read as stopped, the next reconcile would start it, and the start would kill a guest that was only busy. An update that still finds such a VMM under a record that says running — a stop that did not finish — takes it down and applies, rather than leaving the machine stuck.
    #[test]
    fn a_vmm_whose_agent_does_not_answer_reads_running_and_an_update_takes_it_down() {
        let home = Home::new("zombie");
        let share = home.path.join("share");
        fs::create_dir_all(&share).unwrap();
        let smolvm = Smolvm::open().unwrap();
        let spec = spec();
        let launch = launch();
        smolvm
            .create(
                "m1",
                &Machine {
                    spec: &spec,
                    image: "quay.io/x/vm:1",
                    host_port: 32000,
                    share: &share,
                    launch: &launch,
                },
            )
            .unwrap();
        let mut vmm = std::process::Command::new("sh")
            .args(["-c", "sleep 60; true", "_boot-vm"])
            .arg(format!("{}/", vm_data_dir("m1").display()))
            .spawn()
            .unwrap();
        let pid = i32::try_from(vmm.id()).unwrap();
        smolvm
            .db
            .update_vm("m1", |r| {
                r.state = RecordState::Running;
                r.pid = Some(pid);
                r.pid_start_time = smolvm::process::process_start_time(pid);
            })
            .unwrap();
        assert_eq!(smolvm.state("m1").unwrap(), State::Running);

        let mut desired = spec.clone();
        desired.cpus = 1;
        smolvm
            .update(
                "m1",
                &Update {
                    desired: &desired,
                    applied: Some(&spec),
                    image: None,
                },
            )
            .unwrap();
        assert_eq!(smolvm.record("m1").unwrap().unwrap().cpus, 1);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while vmm.try_wait().unwrap().is_none() {
            assert!(
                std::time::Instant::now() < deadline,
                "the dead agent's VMM was left running"
            );
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }

    // TEST_SCENARIO: smolvm refuses to stop a running guest that does not confirm its disks are quiesced, and leaves its VMM up. A stop the controller asked for must still end the machine, so the runner powers that VMM off and the machine reads stopped. Here the guest agent never answers at all.
    #[test]
    fn a_guest_that_does_not_confirm_its_stop_is_powered_off() {
        let home = Home::new("unconfirmed");
        let share = home.path.join("share");
        fs::create_dir_all(&share).unwrap();
        let smolvm = Smolvm::open().unwrap();
        let spec = spec();
        let launch = launch();
        smolvm
            .create(
                "m1",
                &Machine {
                    spec: &spec,
                    image: "quay.io/x/vm:1",
                    host_port: 32000,
                    share: &share,
                    launch: &launch,
                },
            )
            .unwrap();
        let mut vmm = std::process::Command::new("sh")
            .args(["-c", "sleep 60; true", "_boot-vm"])
            .arg(format!("{}/", vm_data_dir("m1").display()))
            .spawn()
            .unwrap();
        let pid = i32::try_from(vmm.id()).unwrap();
        smolvm
            .db
            .update_vm("m1", |r| {
                r.state = RecordState::Running;
                r.pid = Some(pid);
                r.pid_start_time = smolvm::process::process_start_time(pid);
            })
            .unwrap();
        let started = smolvm::process::process_start_time(pid).unwrap();
        fs::write(
            vm_data_dir("m1").join("agent.pid"),
            format!("{pid}\n{started}\n"),
        )
        .unwrap();
        assert!(
            smolvm.runtime.stop_machine("m1").is_err(),
            "smolvm stopped a guest that never confirmed, so this fallback is not needed"
        );
        assert!(vmm.try_wait().unwrap().is_none());

        smolvm.stop("m1").unwrap();
        assert!(
            vmm.try_wait().unwrap().is_some(),
            "the unconfirmed guest's VMM was left running"
        );
        assert_eq!(
            smolvm.record("m1").unwrap().unwrap().actual_state(),
            RecordState::Stopped
        );
    }

    // TEST_SCENARIO: a delete is asked of every runner for an agent's name, and all but one never had that machine. Deleting nothing must succeed, and deleting a machine must leave it absent with its directory gone.
    #[test]
    fn a_delete_removes_the_machine_and_deleting_nothing_succeeds() {
        let home = Home::new("delete");
        let share = home.path.join("share");
        fs::create_dir_all(&share).unwrap();
        let smolvm = Smolvm::open().unwrap();
        smolvm.delete("never-created").unwrap();

        let spec = spec();
        let launch = launch();
        smolvm
            .create(
                "m1",
                &Machine {
                    spec: &spec,
                    image: "quay.io/x/vm:1",
                    host_port: 32000,
                    share: &share,
                    launch: &launch,
                },
            )
            .unwrap();
        smolvm.delete("m1").unwrap();
        assert_eq!(smolvm.state("m1").unwrap(), State::Absent);
        assert!(!vm_data_dir("m1").exists());
    }

    // TEST_SCENARIO: a new image and a new allowlist are applied to the same machine. smolvm reads the image, the command it launches, its workdir, env and allowlist from the record at every start, so the update rewrites those fields and nothing else: the record is the one the create wrote, the port is kept, and the storage disk holds the same bytes. The env is rebuilt from the new image's, so a variable only the old image set is gone.
    #[test]
    fn a_new_image_and_allowlist_are_written_to_the_same_machine() {
        use std::io::{Read, Write};
        let home = Home::new("in-place");
        let share = home.path.join("share");
        let old_tree = home.path.join("images/old/rootfs");
        let new_tree = home.path.join("images/new/rootfs");
        for dir in [&share, &old_tree, &new_tree] {
            fs::create_dir_all(dir).unwrap();
        }
        let smolvm = Smolvm::open().unwrap();
        let old = spec();
        let old_launch = launch();
        smolvm
            .create(
                "m1",
                &Machine {
                    spec: &old,
                    image: old_tree.to_str().unwrap(),
                    host_port: 32000,
                    share: &share,
                    launch: &old_launch,
                },
            )
            .unwrap();
        let created_at = smolvm.record("m1").unwrap().unwrap().created_at;
        fs::OpenOptions::new()
            .write(true)
            .open(storage_disk_path("m1"))
            .unwrap()
            .write_all(b"agent home")
            .unwrap();

        let mut new = spec();
        new.image = "quay.io/x/vm:2".into();
        new.allow_cidrs = vec!["10.96.0.9/32".into()];
        let new_launch = ImageLaunch {
            entrypoint: vec!["/entry2".into()],
            cmd: vec!["serve".into()],
            env: vec!["LANG=C".into()],
            working_dir: "/srv".into(),
        };
        smolvm
            .update(
                "m1",
                &Update {
                    desired: &new,
                    applied: Some(&old),
                    image: Some((new_tree.to_str().unwrap(), &new_launch)),
                },
            )
            .unwrap();

        let record = smolvm.record("m1").unwrap().unwrap();
        assert_eq!(record.created_at, created_at, "the machine was recreated");
        assert_eq!(
            record.image.as_deref(),
            Some(format!("local-dir:{}", new_tree.canonicalize().unwrap().display()).as_str())
        );
        assert!(record.entrypoint.is_empty());
        assert_eq!(
            record.cmd,
            vec![crate::guest::INIT_PATH, "/entry2", "serve"]
        );
        assert_eq!(record.workdir.as_deref(), Some("/srv"));
        assert_eq!(
            record.env,
            vec![
                ("LANG".to_string(), "C".to_string()),
                ("TOKEN".to_string(), "hunter22".to_string()),
            ]
        );
        assert_eq!(record.allowed_cidrs, Some(vec!["10.96.0.9/32".to_string()]));
        assert_eq!(record.ports, vec![(32000, GUEST_AGENT_PORT)]);
        let mut head = [0u8; 10];
        fs::File::open(storage_disk_path("m1"))
            .unwrap()
            .read_exact(&mut head)
            .unwrap();
        assert_eq!(&head, b"agent home");

        new.allow_cidrs.clear();
        smolvm
            .update(
                "m1",
                &Update {
                    desired: &new,
                    applied: Some(&new),
                    image: None,
                },
            )
            .unwrap();
        assert_eq!(
            smolvm.record("m1").unwrap().unwrap().allowed_cidrs,
            None,
            "an update must write the allowlist a create of the same spec would"
        );
    }
}
