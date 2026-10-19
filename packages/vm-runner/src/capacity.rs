use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

use crate::state::{machine_ids, read_spec};

// UNIT_BOUNDARY_DESCRIPTION: whether one more machine fits in the memory this runner was given. A guest takes host memory only as it touches it and hands freed memory back, so a running machine is counted at what its VMM was last measured holding plus a headroom for it to grow into, never above its size, and an owner can run more machines than their sizes add up to. A machine still warming up, one not yet measured, and each in-flight create, which is not on disk yet and would otherwise be counted as nothing right when two creates race, count at least at the warm-up floor. Guests that grow together past what they are counted at can still take the runner over its limit, and the kernel then kills the largest process in the runner's cgroup — a machine's VMM, which raises its own OOM score to be that process — and the runner restarts that machine under a reason of its own; the controller hibernates idle agents before that, from the use the runner reports.

// UNIT_BOUNDARY_DESCRIPTION: how long after its boot began a machine counts at least at the warm-up floor. A harness reaches most of its working set within a minute of the guest answering; the window is fixed rather than ended by the guest's first answer, because the harness only starts then.
pub const WARMUP: Duration = Duration::from_secs(120);

// UNIT_BOUNDARY_DESCRIPTION: what the runner has to hand out. A limit of zero is a runner told nothing about its memory, which admits everything — the controller sets this from the pod's own limit, and a runner that invented one would refuse machines its node had room for.
pub struct Capacity<'a> {
    pub state_dir: &'a Path,
    pub limit_mib: i32,
    // UNIT_BOUNDARY_DESCRIPTION: what is kept back from the machines, for the runner process itself and the VMM threads it runs them on. It is subtracted from the limit rather than added to each machine, because it is paid once however many machines there are.
    pub reserve_mib: i32,
    // UNIT_BOUNDARY_DESCRIPTION: what a measured machine is counted at beyond its measurement, for the guest to grow into between two probes and before the controller acts on pressure.
    pub headroom_mib: i32,
    // UNIT_BOUNDARY_DESCRIPTION: the warm-up floor: what a machine is counted at, at least, until it is measured and for WARMUP after its boot began, never above its size; zero counts it at its size then. The agent's harness starts only once the guest answers and grows to 2 to 3 GiB within the next minute, so a machine measured right after its boot holds little of what it will hold. A machine may be sized to half the runner, so counting every boot at its size would let only two boot at once, and a runner roll or a few wakes together would refuse the rest; the floor lets pool / floor machines warm up together, and a start refused for that is retried by the controller.
    pub boot_mib: i32,
}

impl Capacity<'_> {
    pub fn room_for(
        &self,
        id: &str,
        want_mib: i32,
        committing: &BTreeMap<String, i32>,
        running: &dyn Fn(&str) -> bool,
        resident: &dyn Fn(&str) -> Option<i32>,
        warming: &dyn Fn(&str) -> bool,
    ) -> anyhow::Result<()> {
        if self.limit_mib == 0 {
            return Ok(());
        }
        let used = self.committed(Some(id), committing, running, resident, warming)?;
        if used + self.unmeasured(want_mib) + i64::from(self.reserve_mib)
            > i64::from(self.limit_mib)
        {
            anyhow::bail!(
                "this machine's {want_mib} MiB does not fit: the VM runner has {} MiB for machines and {used} MiB is already committed; stop another agent or give the runner more memory",
                self.limit_mib - self.reserve_mib
            );
        }
        Ok(())
    }

    // UNIT_BOUNDARY_DESCRIPTION: the memory the other machines hold, as admission counts it — what each in-flight operation asked for, and each running machine at its measured use plus headroom, raised to the warm-up floor while it is unmeasured or warming up, and never above its applied size.
    pub fn committed(
        &self,
        except: Option<&str>,
        committing: &BTreeMap<String, i32>,
        running: &dyn Fn(&str) -> bool,
        resident: &dyn Fn(&str) -> Option<i32>,
        warming: &dyn Fn(&str) -> bool,
    ) -> anyhow::Result<i64> {
        let mut ids = machine_ids(self.state_dir)?;
        ids.extend(committing.keys().cloned());
        let mut used: i64 = 0;
        for other in ids.iter().filter(|other| Some(other.as_str()) != except) {
            if let Some(mib) = committing.get(other) {
                used += self.unmeasured(*mib);
                continue;
            }
            if !running(other) {
                continue;
            }
            if let Some(applied) = read_spec(self.state_dir, other) {
                let size = applied.memory_mib;
                let floor = self.unmeasured(size);
                used += resident(other).map_or(floor, |mib| {
                    let counted = i64::from(size.min(mib.saturating_add(self.headroom_mib)));
                    if warming(other) {
                        counted.max(floor)
                    } else {
                        counted
                    }
                });
            }
        }
        Ok(used)
    }

    fn unmeasured(&self, size_mib: i32) -> i64 {
        i64::from(if self.boot_mib > 0 {
            size_mib.min(self.boot_mib)
        } else {
            size_mib
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::MachineSpec;
    use crate::state::write_spec;
    use crate::testdir::TempDir;
    use std::fs;

    // TEST_SCENARIO: this refusal is not a log line. It is written into the Agent's status by the controller, which passes it through unchanged, so it is what a person reads when their agent will not start, and what a runbook quotes. The wording is pinned, with the three numbers in the places the reader expects them.
    #[test]
    fn the_refusal_reads_as_the_status_shows_it() {
        let dir = TempDir::new("wording");
        let state = dir.path();

        let ours = Capacity {
            state_dir: state,
            limit_mib: 8192,
            reserve_mib: 1024,
            headroom_mib: 0,
            boot_mib: 0,
        }
        .room_for(
            "agent-a",
            2048,
            &committing(&[("agent-b", 6000)]),
            &never,
            &unmeasured,
            &never,
        )
        .unwrap_err()
        .to_string();

        assert_eq!(
            ours,
            "this machine's 2048 MiB does not fit: the VM runner has 7168 MiB for machines and 6000 MiB is already committed; stop another agent or give the runner more memory"
        );
    }

    // TEST_SCENARIO: the limit comes from the runner's own container, and a runner that was told nothing has no business inventing one — refusing there would idle a node that had room. The check exists to stop the runner being killed for going over a limit it knows about, not to ration on a guess.
    #[test]
    fn a_runner_that_was_given_no_limit_admits_anything() {
        let dir = TempDir::new("no-limit");
        assert!(Capacity {
            state_dir: dir.path(),
            limit_mib: 0,
            reserve_mib: 512,
            headroom_mib: 0,
            boot_mib: 0,
        }
        .room_for(
            "agent-a",
            64_000,
            &BTreeMap::new(),
            &never,
            &unmeasured,
            &never
        )
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
            headroom_mib: 0,
            boot_mib: 0,
        };
        let running_b = |id: &str| id == "agent-b";

        assert!(
            capacity
                .room_for(
                    "agent-a",
                    4096,
                    &BTreeMap::new(),
                    &running_b,
                    &unmeasured,
                    &never
                )
                .is_ok(),
            "the stopped machine was counted, and a machine that fits was refused"
        );
        assert!(
            capacity
                .room_for(
                    "agent-a",
                    4097,
                    &BTreeMap::new(),
                    &|_: &str| true,
                    &unmeasured,
                    &never
                )
                .is_err(),
            "both were counted and there is no room"
        );
    }

    // TEST_SCENARIO: guests hold only what they touch, so a running machine counts at its measured use plus headroom, which is what lets an owner run more machines than their sizes add up to. It never counts above its size, so a guest measured near its cap is held to it, and one not yet measured counts at its size until the prober has looked.
    #[test]
    fn a_running_machine_counts_at_its_measured_use_plus_headroom() {
        let dir = TempDir::new("measured");
        let state = dir.path();
        created(state, "agent-b", 4096);
        created(state, "agent-c", 4096);
        let capacity = Capacity {
            state_dir: state,
            limit_mib: 8192,
            reserve_mib: 0,
            headroom_mib: 256,
            boot_mib: 0,
        };
        let all = |_: &str| true;
        let used = |mib: i32| move |id: &str| (id == "agent-b").then_some(mib);

        assert!(
            capacity
                .room_for(
                    "agent-a",
                    8192 - 4096 - 768,
                    &BTreeMap::new(),
                    &all,
                    &used(512),
                    &never
                )
                .is_ok(),
            "agent-b was counted at more than its 512 MiB plus 256 MiB of headroom"
        );
        assert!(
            capacity
                .room_for(
                    "agent-a",
                    8192 - 4096 - 767,
                    &BTreeMap::new(),
                    &all,
                    &used(512),
                    &never
                )
                .is_err(),
            "agent-b was counted at less than its use plus headroom"
        );
        assert!(
            capacity
                .room_for("agent-a", 1, &BTreeMap::new(), &all, &used(4000), &never)
                .is_err(),
            "a machine near its size was counted above it, or the unmeasured one below its size"
        );
        assert!(
            capacity
                .room_for("agent-a", 1, &BTreeMap::new(), &all, &unmeasured, &never)
                .is_err(),
            "an unmeasured machine was counted below its size"
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
            headroom_mib: 0,
            boot_mib: 0,
        };
        assert!(
            capacity
                .room_for(
                    "agent-a",
                    4096,
                    &committing(&[("agent-b", 4096)]),
                    &never,
                    &unmeasured,
                    &never
                )
                .is_ok(),
            "the two exactly fill the runner"
        );
        assert!(
            capacity
                .room_for(
                    "agent-a",
                    4097,
                    &committing(&[("agent-b", 4096)]),
                    &never,
                    &unmeasured,
                    &never
                )
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
                headroom_mib: 0,
                boot_mib: 0,
            }
            .room_for(
                "agent-a",
                4097,
                &committing(&[("agent-b", 4096)]),
                &|_: &str| true,
                &unmeasured,
                &never
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
                headroom_mib: 0,
                boot_mib: 0,
            }
            .room_for(
                "agent-a",
                6000,
                &committing(&[("agent-a", 6000)]),
                &|_: &str| true,
                &unmeasured,
                &never
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
            headroom_mib: 0,
            boot_mib: 0,
        };

        assert!(
            capacity
                .room_for(
                    "agent-a",
                    8192 - 1024,
                    &BTreeMap::new(),
                    &never,
                    &unmeasured,
                    &never
                )
                .is_ok(),
            "an empty runner cannot fill what it has left"
        );
        assert!(
            capacity
                .room_for(
                    "agent-a",
                    8192 - 1023,
                    &BTreeMap::new(),
                    &never,
                    &unmeasured,
                    &never
                )
                .is_err(),
            "a machine was given a byte of the runner's own memory"
        );
    }

    // TEST_SCENARIO: machines sized to half the runner must still boot several at once — after a runner roll every machine of the owner boots together. An unmeasured machine, booting or in flight, counts at the boot estimate rather than its size, and a measured one at its use, so only the boot estimate decides how many boot at a time.
    #[test]
    fn half_runner_machines_boot_together_at_the_boot_estimate() {
        let dir = TempDir::new("boot");
        let state = dir.path();
        created(state, "agent-b", 4096);
        let capacity = Capacity {
            state_dir: state,
            limit_mib: 8192,
            reserve_mib: 0,
            headroom_mib: 0,
            boot_mib: 2048,
        };
        let all = |_: &str| true;

        assert!(
            capacity
                .room_for(
                    "agent-a",
                    4096,
                    &committing(&[("agent-c", 4096)]),
                    &all,
                    &unmeasured,
                    &never
                )
                .is_ok(),
            "three half-runner machines booting together did not fit at 2 GiB each"
        );
        assert!(
            capacity
                .room_for(
                    "agent-a",
                    4096,
                    &committing(&[("agent-c", 4096), ("agent-d", 4096), ("agent-e", 4096)]),
                    &all,
                    &unmeasured,
                    &never
                )
                .is_err(),
            "a fifth 2 GiB boot estimate fit into 8 GiB"
        );
        assert!(
            capacity
                .room_for(
                    "agent-a",
                    4096,
                    &committing(&[("agent-c", 4096), ("agent-d", 4096)]),
                    &all,
                    &|id: &str| (id == "agent-b").then_some(4000),
                    &never
                )
                .is_err(),
            "a measured machine was counted at the boot estimate rather than its use"
        );
    }

    // TEST_SCENARIO: a machine measured right after its boot holds a few hundred MiB, but its harness starts only once the guest answers and grows to 2 to 3 GiB within the next minute. While it warms up it counts at the warm-up floor however little it was measured at, so machines that boot together are not admitted into room their harnesses will take; once warmed up it counts at its use plus headroom again.
    #[test]
    fn a_just_started_machine_measured_small_counts_at_the_warm_up_floor() {
        let dir = TempDir::new("warmup");
        let state = dir.path();
        created(state, "agent-b", 4096);
        let capacity = Capacity {
            state_dir: state,
            limit_mib: 8192,
            reserve_mib: 0,
            headroom_mib: 256,
            boot_mib: 3072,
        };
        let all = |_: &str| true;
        let small = |_: &str| Some(300);
        let warming = |id: &str| id == "agent-b";
        let starts = committing(&[("agent-c", 4096)]);

        assert!(
            capacity
                .room_for("agent-a", 4096, &starts, &all, &small, &warming)
                .is_err(),
            "a warming machine measured at 300 MiB was counted below the 3 GiB floor"
        );
        assert!(
            capacity
                .room_for("agent-a", 4096, &starts, &all, &small, &never)
                .is_ok(),
            "a warmed-up machine was still counted at the floor rather than its use plus headroom"
        );
        assert_eq!(
            capacity
                .committed(
                    None,
                    &BTreeMap::new(),
                    &all,
                    &|_: &str| Some(3500),
                    &warming
                )
                .unwrap(),
            3756,
            "a warming machine already past the floor was not counted at its use plus headroom"
        );
    }

    fn never(_: &str) -> bool {
        false
    }

    fn unmeasured(_: &str) -> Option<i32> {
        None
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
}
