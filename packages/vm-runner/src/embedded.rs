use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::Context;
use smolvm::agent::{state_probe, vm_data_dir, HostMount, PortMapping, VmResources};
use smolvm::config::{RecordState, VmRecord};
use smolvm::data::image_source::{classify, resolve, ResolvedImage};
use smolvm::db::SmolvmDb;
use smolvm::embedded::{EmbeddedRuntime, MachineSpec as SmolvmSpec};
use smolvm::network::NetworkBackend;
use smolvm::storage::{expand_disk, Storage, StorageDisk, STORAGE_DISK_FILENAME};

use crate::api::{MachineSpec, STATE_ABSENT, STATE_RUNNING, STATE_STOPPED};
use crate::guest::SHARE_PATH;
use crate::runtime::{
    adopt_kept_storage, clear_for_start, discard_overlay, grown_storage, kept_dir, kill_orphans,
    move_storage, timed, updated_env, vmm_gone, workload, Machine, Runtime, GUEST_AGENT_PORT,
    VMM_EXIT_WAIT,
};

// UNIT_BOUNDARY_DESCRIPTION: the runtime backed by smolvm's embedding API. It keeps smolvm's own state — the machine database and the machine directories — exactly where the smolvm CLI keeps it under the runner's HOME, so machines the Go runner created are machines this one can start, stop and delete. Each call is synchronous and may block for as long as a boot takes, so the server runs them off its async threads.
pub struct Smolvm {
    runtime: EmbeddedRuntime,
    db: SmolvmDb,
    proc_root: PathBuf,
    home: Option<PathBuf>,
}

const USER: &str = "root";

// UNIT_BOUNDARY_DESCRIPTION: the label smolvm stores on every machine this runner creates. smolvm never reads it; it is how an operator listing smolvm's machines tells the runner's own from anything else in the same database.
const MANAGED_BY: (&str, &str) = ("app.kubernetes.io/managed-by", "vm-runner");

impl Smolvm {
    pub fn open() -> anyhow::Result<Self> {
        Ok(Self {
            runtime: EmbeddedRuntime::new().context("opening the smolvm runtime")?,
            db: SmolvmDb::open().context("opening the smolvm database")?,
            proc_root: PathBuf::from("/proc"),
            home: std::env::var_os("HOME")
                .filter(|home| !home.is_empty())
                .map(PathBuf::from),
        })
    }

    fn kept(&self, id: &str) -> Option<PathBuf> {
        self.home.as_deref().map(|home| kept_dir(home, id))
    }

    fn adopt_kept(&self, id: &str) -> anyhow::Result<()> {
        match self.kept(id) {
            Some(kept) => adopt_kept_storage(&kept, &vm_data_dir(id))
                .with_context(|| format!("restoring the storage disk of {id}")),
            None => Ok(()),
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: collects the exit status of VMM processes that have ended. smolvm spawns each VMM detached and never waits on it, so an embedder that does not sweep keeps one zombie per machine that ever stopped. Called on the runner's own tick.
    pub fn reap(&self) {
        smolvm::process::reap_vm_children();
    }

    fn record(&self, id: &str) -> anyhow::Result<Option<VmRecord>> {
        Ok(self.db.get_vm(id)?)
    }
}

impl Runtime for Smolvm {
    // UNIT_BOUNDARY_DESCRIPTION: read the way `smolvm machine status` reads it: a record that says running is only running if its VMM is alive and its agent answers. A VMM whose agent died reads as stopped, so the next start takes it down rather than trusting it.
    fn state(&self, id: &str) -> anyhow::Result<&'static str> {
        Ok(match self.record(id)? {
            None => STATE_ABSENT,
            Some(record) if state_probe::resolve_state(id, &record) == RecordState::Running => {
                STATE_RUNNING
            }
            Some(_) => STATE_STOPPED,
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
            self.adopt_kept(id)?;
            if let Some(gib) = storage_gib.filter(|_| !has_qcow2_storage(&vm_data_dir(id))) {
                raw_storage_disk(id, gib)?;
            }
            Ok(())
        })
    }

    fn update(
        &self,
        id: &str,
        desired: &MachineSpec,
        applied: Option<&MachineSpec>,
    ) -> anyhow::Result<()> {
        let secrets: Vec<&str> = desired.env.values().map(String::as_str).collect();
        timed("update", id, &secrets, || {
            let record = self
                .record(id)?
                .ok_or_else(|| anyhow::anyhow!("machine '{id}' not found"))?;
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
            let grown = grown_storage(applied, desired);
            if let Some(gib) = grown {
                let disk = vm_data_dir(id).join(STORAGE_DISK_FILENAME);
                if disk.exists() {
                    expand_disk::<Storage>(&disk, gib)?;
                }
            }
            self.db.update_vm(id, |r| {
                r.cpus = cpus;
                r.mem = mem;
                if let Some(gib) = grown {
                    r.storage_gb = Some(gib);
                }
                r.env = updated_env(&r.env, applied, desired);
            })?;
            Ok(())
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: a start is always a fresh boot. Whatever the last VMM left is cleared first — a stop issued to a machine that died with its runner, a VMM that outlived its stop, its sockets and lock files, the root overlay — and a start that fails kills any VMM it left half-booted, so the next attempt does not inherit it.
    fn start(&self, id: &str) -> anyhow::Result<()> {
        self.adopt_kept(id)?;
        let dir = vm_data_dir(id);
        if dir.is_dir() {
            let _ = self.runtime.stop_machine(id);
            clear_for_start(id, &self.proc_root, &dir);
        }
        let result = timed("start", id, &[], || Ok(self.runtime.start_machine(id)?));
        if result.is_err() {
            kill_orphans(&self.proc_root, &dir);
        }
        result
    }

    fn stop(&self, id: &str) -> anyhow::Result<()> {
        timed("stop", id, &[], || Ok(self.runtime.stop_machine(id)?))?;
        discard_overlay(id, &self.proc_root, &vm_data_dir(id));
        Ok(())
    }

    fn delete(&self, id: &str) -> anyhow::Result<()> {
        timed("delete", id, &[], || Ok(self.runtime.delete_machine(id)?))
    }

    // UNIT_BOUNDARY_DESCRIPTION: the disk is moved only once no VMM holds it, because a VMM that is still exiting may still be writing to it.
    fn delete_keeping_storage(&self, id: &str) -> anyhow::Result<()> {
        let dir = vm_data_dir(id);
        if dir.is_dir() {
            let kept = self.kept(id).ok_or_else(|| {
                anyhow::anyhow!("HOME is not set, so there is nowhere to keep the storage disk of {id} across the new image")
            })?;
            if !vmm_gone(&self.proc_root, &dir, VMM_EXIT_WAIT) {
                anyhow::bail!("machine {id} still has a VMM holding its disks, so its storage disk cannot be kept across the new image");
            }
            move_storage(&dir, &kept)
                .with_context(|| format!("keeping the storage disk of {id}"))?;
        }
        self.delete(id)
    }

    fn discard_kept_storage(&self, id: &str) -> anyhow::Result<()> {
        match self.kept(id).map(std::fs::remove_dir_all) {
            Some(Err(e)) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the smolvm record for one machine, in the shape the Go runner's `machine create` flags produced: the image, cpus, memory and storage disk; networking on the virtio-net backend with egress limited to the spec's CIDRs; the agent port published on a loopback port; the share mounted read-only; and the workload platform-init hands off to.
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

// UNIT_BOUNDARY_DESCRIPTION: the image as the record must name it. A directory becomes a `local-dir:` reference smolvm boots in place, which is what lets every machine of an image share one unpacked tree. An archive is staged into smolvm's own cache and named `local:`. A registry reference passes through. The CLI resolves the same way before it writes a record; the embedding API does not, so it is done here.
fn resolved_image(image: &str) -> anyhow::Result<String> {
    Ok(match resolve(classify(image))? {
        ResolvedImage::Registry(reference) => reference,
        ResolvedImage::Local { reference, .. } => reference,
    })
}

// UNIT_BOUNDARY_DESCRIPTION: creates the machine's storage disk as a raw sparse file before its first boot. Left to smolvm, a disk of smolvm's default size is made instead as a qcow2 overlay over the template shipped with the runner image, named by its absolute path in that image — so an upgrade that ships a different template would change the bytes under every such agent's home. A raw disk depends on nothing, and smolvm formats it on first boot as it does any other size.
fn raw_storage_disk(id: &str, gib: u64) -> anyhow::Result<()> {
    StorageDisk::open_or_create_at(&vm_data_dir(id).join(STORAGE_DISK_FILENAME), gib)?;
    Ok(())
}

pub fn storage_disk_path(id: &str) -> PathBuf {
    vm_data_dir(id).join(STORAGE_DISK_FILENAME)
}

pub fn template_backed_storage(id: &str) -> bool {
    has_qcow2_storage(&vm_data_dir(id))
}

fn has_qcow2_storage(dir: &Path) -> bool {
    dir.join(Path::new(STORAGE_DISK_FILENAME).with_extension("qcow2"))
        .exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::ImageLaunch;
    use std::fs;
    use std::sync::Mutex;

    // UNIT_BOUNDARY_DESCRIPTION: smolvm finds its database and machine directories through HOME and the XDG variables, which are process-wide. The tests that open a real runtime take this lock and point both at their own directory, so they cannot see each other's machines.
    static HOME: Mutex<()> = Mutex::new(());

    struct Home {
        path: PathBuf,
        _lock: std::sync::MutexGuard<'static, ()>,
    }

    impl Home {
        fn new(name: &str) -> Self {
            let lock = HOME.lock().unwrap_or_else(|e| e.into_inner());
            let path = std::env::temp_dir()
                .join(format!("vm-runner-smolvm-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            std::env::set_var("HOME", &path);
            std::env::set_var("XDG_DATA_HOME", path.join("data"));
            std::env::set_var("XDG_CACHE_HOME", path.join("cache"));
            Self { path, _lock: lock }
        }
    }

    impl Drop for Home {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
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

    // TEST_SCENARIO: the record a create writes is the machine: what it boots, how big it is, where it may send traffic, which port it is published on and what it runs. Each field is what the Go runner's `machine create` flags said, read back from smolvm's own database rather than from what this code meant to write.
    #[test]
    fn a_created_machine_is_recorded_the_way_the_go_runner_created_it() {
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
                    launch: Some(&launch),
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
        assert_eq!(smolvm.state("m1").unwrap(), STATE_STOPPED);
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
                    launch: Some(&launch),
                },
            )
            .unwrap();

        let disk = storage_disk_path("m1");
        assert!(disk.exists(), "no raw disk was made");
        assert_eq!(fs::metadata(&disk).unwrap().len(), 20 << 30);
        assert!(!template_backed_storage("m1"));
    }

    // TEST_SCENARIO: an update reshapes a stopped machine in place — size, env, and a disk that grows — so the agent keeps its disk across a resize. A running machine is refused, because smolvm reads the record only at boot and a change written under a live guest would be a lie until the next one.
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
                    launch: Some(&launch),
                },
            )
            .unwrap();

        let mut desired = spec();
        desired.cpus = 4;
        desired.memory_mib = 4096;
        desired.storage_gib = 30;
        desired.env = [("NEW".to_string(), "x".to_string())].into();
        smolvm.update("m1", &desired, Some(&applied)).unwrap();

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

        smolvm
            .db
            .update_vm("m1", |r| {
                r.state = RecordState::Running;
                r.pid = Some(std::process::id() as i32);
                r.pid_start_time = smolvm::process::process_start_time(std::process::id() as i32);
            })
            .unwrap();
        assert!(smolvm.update("m1", &desired, Some(&applied)).is_err());
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
                    launch: Some(&launch),
                },
            )
            .unwrap_err()
            .to_string();
        assert!(err.starts_with("smolvm machine create: "), "{err}");
        assert!(!err.contains("hunter22"), "{err}");
        assert_eq!(smolvm.state("m1").unwrap(), STATE_ABSENT);
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
                    launch: Some(&launch),
                },
            )
            .unwrap();
        smolvm.delete("m1").unwrap();
        assert_eq!(smolvm.state("m1").unwrap(), STATE_ABSENT);
        assert!(!vm_data_dir("m1").exists());
    }

    // TEST_SCENARIO: a new image is a new machine under the same name. The agent's disk leaves the old machine's directory before its delete and is what the recreated machine is created with — the same bytes, grown to the new size, never a fresh empty disk — and nothing is left kept afterwards.
    #[test]
    fn a_recreated_machine_is_created_on_the_disk_the_old_one_had() {
        use std::io::{Read, Write};
        let home = Home::new("recreate");
        let share = home.path.join("share");
        fs::create_dir_all(&share).unwrap();
        let smolvm = Smolvm::open().unwrap();
        let launch = launch();
        let old = spec();
        let machine = |spec, image| Machine {
            spec,
            image,
            host_port: 32000,
            share: &share,
            launch: Some(&launch),
        };
        smolvm
            .create("m1", &machine(&old, "quay.io/x/vm:1"))
            .unwrap();
        fs::OpenOptions::new()
            .write(true)
            .open(storage_disk_path("m1"))
            .unwrap()
            .write_all(b"agent home")
            .unwrap();

        smolvm.delete_keeping_storage("m1").unwrap();
        assert_eq!(smolvm.state("m1").unwrap(), STATE_ABSENT);
        assert!(kept_dir(&home.path, "m1").join("storage.raw").exists());

        let mut new = spec();
        new.image = "quay.io/x/vm:2".into();
        new.storage_gib = 30;
        smolvm
            .create("m1", &machine(&new, "quay.io/x/vm:2"))
            .unwrap();
        let mut head = [0u8; 10];
        fs::File::open(storage_disk_path("m1"))
            .unwrap()
            .read_exact(&mut head)
            .unwrap();
        assert_eq!(&head, b"agent home");
        assert_eq!(
            fs::metadata(storage_disk_path("m1")).unwrap().len(),
            30 << 30
        );
        assert!(!kept_dir(&home.path, "m1").exists());

        smolvm.delete_keeping_storage("m1").unwrap();
        smolvm.discard_kept_storage("m1").unwrap();
        assert!(!kept_dir(&home.path, "m1").exists());
        smolvm.discard_kept_storage("m1").unwrap();
    }

    // TEST_SCENARIO: a machine the Go runner made has a qcow2 storage disk when it was created at smolvm's default size. It is recognised as such, so the runner can say which agents depend on the shipped template before an upgrade changes it.
    #[test]
    fn a_template_backed_disk_is_recognised() {
        let _home = Home::new("qcow2");
        let dir = vm_data_dir("old");
        fs::create_dir_all(&dir).unwrap();
        assert!(!template_backed_storage("old"));
        fs::write(dir.join("storage.qcow2"), "x").unwrap();
        assert!(template_backed_storage("old"));
    }
}
