use std::collections::BTreeMap;
use std::path::Path;

use crate::state::{machine_ids, read_spec};

// UNIT_BOUNDARY_DESCRIPTION: whether one more machine fits in the memory this runner was given. A microVM's memory is taken from the runner's own container at boot, so a machine admitted over the limit is not slow — it is the runner being killed for going over its limit, taking every machine on the node with it. Admission is therefore decided before the machine is created, and against what the other machines are actually using: their specs on disk for the ones already running, and the size each in-flight create asked for, which is not on disk yet and would otherwise be counted as nothing right when two creates race.

// UNIT_BOUNDARY_DESCRIPTION: what the runner has to hand out. A limit of zero is a runner told nothing about its memory, which admits everything — the controller sets this from the pod's own limit, and a runner that invented one would refuse machines its node had room for.
pub struct Capacity<'a> {
    pub state_dir: &'a Path,
    pub limit_mib: i32,
    // UNIT_BOUNDARY_DESCRIPTION: what is kept back from the machines, for the runner process itself and the VMM threads it runs them on. It is subtracted from the limit rather than added to each machine, because it is paid once however many machines there are.
    pub reserve_mib: i32,
}

impl Capacity<'_> {
    pub fn room_for(
        &self,
        id: &str,
        want_mib: i32,
        committing: &BTreeMap<String, i32>,
        running: &dyn Fn(&str) -> bool,
    ) -> anyhow::Result<()> {
        if self.limit_mib == 0 {
            return Ok(());
        }
        let mut ids = machine_ids(self.state_dir)?;
        ids.extend(committing.keys().cloned());
        let mut used: i64 = 0;
        for other in ids.iter().filter(|other| other.as_str() != id) {
            if let Some(mib) = committing.get(other) {
                used += i64::from(*mib);
                continue;
            }
            if !running(other) {
                continue;
            }
            if let Some(applied) = read_spec(self.state_dir, other) {
                used += i64::from(applied.memory_mib);
            }
        }
        if used + i64::from(want_mib) + i64::from(self.reserve_mib) > i64::from(self.limit_mib) {
            anyhow::bail!(
                "this machine's {want_mib} MiB does not fit: the VM runner has {} MiB for machines and {used} MiB is already committed; stop another agent or give the runner more memory",
                self.limit_mib - self.reserve_mib
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::MachineSpec;
    use crate::gosource;
    use crate::state::write_spec;
    use std::fs;
    use std::path::PathBuf;

    // TEST_SCENARIO: this refusal is not a log line. It is written into the Agent's status by the controller, which passes it through unchanged, so it is what a person reads when their agent will not start — and during a rollout the same cluster answers with both runners. Two wordings for one condition is a support question that starts with which runner answered.
    #[test]
    fn the_refusal_reads_exactly_as_the_go_runners_does() {
        let dir = TempDir::new("wording");
        let state = dir.path();

        let ours = Capacity {
            state_dir: state,
            limit_mib: 8192,
            reserve_mib: 1024,
        }
        .room_for("agent-a", 2048, &committing(&[("agent-b", 6000)]), &never)
        .unwrap_err()
        .to_string();

        let go = gosource::read("server.go");
        let args = gosource::call_args_in(&go, "(s *Server) roomFor", "fmt.Errorf(")
            .expect("server.go still refuses a machine that does not fit");
        let format = args
            .split('"')
            .nth(1)
            .expect("the refusal is still a literal in roomFor");
        let theirs = format
            .replacen("%d", "2048", 1)
            .replacen("%d", &(8192 - 1024).to_string(), 1)
            .replacen("%d", "6000", 1);

        assert_eq!(ours, theirs, "the two runners refuse in different words");
    }

    // TEST_SCENARIO: the limit comes from the runner's own container, and a runner that was told nothing has no business inventing one — refusing there would idle a node that had room. The check exists to stop the runner being killed for going over a limit it knows about, not to ration on a guess.
    #[test]
    fn a_runner_that_was_given_no_limit_admits_anything() {
        let dir = TempDir::new("no-limit");
        assert!(Capacity {
            state_dir: dir.path(),
            limit_mib: 0,
            reserve_mib: 512,
        }
        .room_for("agent-a", 64_000, &BTreeMap::new(), &never)
        .is_ok());
    }

    // TEST_SCENARIO: what is already spent is what the running machines were created with, read from their specs. A machine that is stopped is holding no memory and must not be counted, or a node fills up with machines nobody is running.
    #[test]
    fn only_the_machines_actually_running_are_counted() {
        let dir = TempDir::new("running");
        let state = dir.path();
        created(state, "agent-b", 4096);
        created(state, "agent-c", 4096);

        let capacity = Capacity {
            state_dir: state,
            limit_mib: 8192,
            reserve_mib: 0,
        };
        let running_b = |id: &str| id == "agent-b";

        assert!(
            capacity
                .room_for("agent-a", 4096, &BTreeMap::new(), &running_b)
                .is_ok(),
            "the stopped machine was counted, and a machine that fits was refused"
        );
        assert!(
            capacity
                .room_for("agent-a", 4097, &BTreeMap::new(), &|_: &str| true)
                .is_err(),
            "both were counted and there is no room"
        );
    }

    // TEST_SCENARIO: a machine being created has no spec on disk and is not running yet, so nothing about it is visible to the next create — which is exactly when two of them race. The size each create asked for is therefore counted while it is in flight, or a node admits two machines into the room for one.
    #[test]
    fn a_machine_still_being_created_is_counted_at_the_size_it_asked_for() {
        let dir = TempDir::new("in-flight");
        let state = dir.path();

        let capacity = Capacity {
            state_dir: state,
            limit_mib: 8192,
            reserve_mib: 0,
        };
        assert!(
            capacity
                .room_for("agent-a", 4096, &committing(&[("agent-b", 4096)]), &never)
                .is_ok(),
            "the two exactly fill the runner"
        );
        assert!(
            capacity
                .room_for("agent-a", 4097, &committing(&[("agent-b", 4096)]), &never)
                .is_err(),
            "a machine in flight was counted as nothing"
        );
    }

    // TEST_SCENARIO: a machine being resized is running at its old size while it asks for its new one, and the in-flight size is the one that will be paid. Counting the spec on disk instead would let a machine growing from 512 MiB to 4 GiB be admitted against its old footprint.
    #[test]
    fn a_machine_growing_is_counted_at_the_size_it_is_growing_to() {
        let dir = TempDir::new("growing");
        let state = dir.path();
        created(state, "agent-b", 512);

        assert!(
            Capacity {
                state_dir: state,
                limit_mib: 8192,
                reserve_mib: 0,
            }
            .room_for(
                "agent-a",
                4097,
                &committing(&[("agent-b", 4096)]),
                &|_: &str| true
            )
            .is_err(),
            "the old 512 MiB spec was counted instead of the 4096 MiB being committed"
        );
    }

    // TEST_SCENARIO: a machine that is being reshaped is admitted against the room its own memory does not have to be found again. Counting it twice would refuse every restart of the largest machine on a node — the one case where the runner is provably able to run it, because it is running it.
    #[test]
    fn a_machine_is_never_weighed_against_itself() {
        let dir = TempDir::new("itself");
        let state = dir.path();
        created(state, "agent-a", 6000);

        assert!(
            Capacity {
                state_dir: state,
                limit_mib: 8192,
                reserve_mib: 0,
            }
            .room_for(
                "agent-a",
                6000,
                &committing(&[("agent-a", 6000)]),
                &|_: &str| true
            )
            .is_ok(),
            "a machine was refused the memory it is already running on"
        );
    }

    // TEST_SCENARIO: the reserve is what the runner process and its VMM threads run in. Handing it to a machine is how the whole runner gets killed for going over its container limit — every machine on the node with it — so it is subtracted from what can be admitted, once, however many machines there are.
    #[test]
    fn the_reserve_is_never_handed_to_a_machine() {
        let dir = TempDir::new("reserve");
        let capacity = Capacity {
            state_dir: dir.path(),
            limit_mib: 8192,
            reserve_mib: 1024,
        };

        assert!(
            capacity
                .room_for("agent-a", 8192 - 1024, &BTreeMap::new(), &never)
                .is_ok(),
            "an empty runner cannot fill what it has left"
        );
        assert!(
            capacity
                .room_for("agent-a", 8192 - 1023, &BTreeMap::new(), &never)
                .is_err(),
            "a machine was given a byte of the runner's own memory"
        );
    }

    fn never(_: &str) -> bool {
        false
    }

    fn committing(entries: &[(&str, i32)]) -> BTreeMap<String, i32> {
        entries
            .iter()
            .map(|(id, mib)| ((*id).to_string(), *mib))
            .collect()
    }

    fn created(state_dir: &Path, id: &str, memory_mib: i32) {
        fs::create_dir_all(state_dir.join(id)).unwrap();
        write_spec(
            state_dir,
            id,
            &MachineSpec {
                image: "quay.io/x/vm:1".into(),
                memory_mib,
                ..Default::default()
            },
        )
        .unwrap();
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("vm-runner-capacity-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}
