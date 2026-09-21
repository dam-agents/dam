use std::time::{Duration, SystemTime};

use crate::api::{
    MachineSpec, STATE_ABSENT, STATE_CREATING, STATE_RESTARTING, STATE_RUNNING, STATE_STARTING,
    STATE_STOPPED, STATE_STOPPING,
};
use crate::state::is_image_ref;

// UNIT_BOUNDARY_DESCRIPTION: what the runner decides to do about one machine, and nothing about carrying it out. The controller sends the same desired shape every reconcile, roughly once a minute, so every decision here is made again and again against a machine that is already in some state — which is why it is separated from the work: a decision that is wrong once is wrong every minute, and the only way to see that is to be able to ask it without a hypervisor.

// UNIT_BOUNDARY_DESCRIPTION: how long a machine that once answered may stay quiet before it is restarted. Both halves of the condition matter and neither means anything alone: a machine that has never answered is still booting, and one that answered a moment ago is simply between checks. Matched against the Go runner, which restarts on the same rule.
pub const UNHEALTHY_RESTART: Duration = Duration::from_secs(10 * 60);

// UNIT_BOUNDARY_DESCRIPTION: what the runner is about to do to a machine, and whether it is doing it because the guest stopped answering rather than because its shape changed. The two produce the same operation and must be told apart afterwards: one is a restart the controller asked for, the other is a machine the runner gave up on, and only the second is worth counting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Plan {
    pub op: &'static str,
    pub unhealthy: bool,
}

// UNIT_BOUNDARY_DESCRIPTION: the health of one machine as the runner has seen it. Read only while the machine reads as running: a restart's old guest answers until the stop lands, and a machine being stopped answers until it dies, so an answer from either says nothing about the machine that is coming up.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Health {
    pub ever_ready: bool,
    pub quiet_since: Option<SystemTime>,
}

impl Health {
    // UNIT_BOUNDARY_DESCRIPTION: records one observation of a machine that reads as running. An answer resets everything, because a machine that answers now is not a machine that has been quiet — keeping the old quiet mark would restart a machine that recovered on its own.
    pub fn observed_running(&mut self, ready: bool, now: SystemTime) {
        if ready {
            *self = Health {
                ever_ready: true,
                quiet_since: None,
            };
        } else if self.quiet_since.is_none() {
            self.quiet_since = Some(now);
        }
    }

    pub fn dead_for_long(&self, now: SystemTime) -> bool {
        let Some(since) = self.quiet_since else {
            return false;
        };
        self.ever_ready
            && now
                .duration_since(since)
                .is_ok_and(|quiet| quiet > UNHEALTHY_RESTART)
    }
}

// UNIT_BOUNDARY_DESCRIPTION: whether an answer from the guest may be believed in this state. A machine on its way up is read this way deliberately: the runtime's own start call lingers seconds past the moment the guest begins serving, and those seconds used to be spent telling a person their agent was not ready.
pub fn reads_ready(state: &str) -> bool {
    matches!(state, STATE_RUNNING | STATE_CREATING | STATE_STARTING)
}

// UNIT_BOUNDARY_DESCRIPTION: what to do about a machine, or nothing when it is already what it should be. `status` reports an operation that is still running as the machine's state, so a stop that arrives mid-boot is planned against that too rather than dropped — the alternative is a machine nobody believes is running and nobody stops.
pub fn plan(
    applied: Option<&MachineSpec>,
    desired: &MachineSpec,
    state: &str,
    ready: bool,
    dead_for_long: bool,
) -> Option<Plan> {
    let doing = |op| {
        Some(Plan {
            op,
            unhealthy: false,
        })
    };

    if !desired.running {
        if matches!(state, STATE_ABSENT | STATE_STOPPED | STATE_STOPPING) {
            return None;
        }
        return doing(STATE_STOPPING);
    }

    if let Some(applied) = applied {
        if egress_changed(applied, desired) && state != STATE_ABSENT {
            // UNIT_BOUNDARY_DESCRIPTION: a machine whose allowlist has moved is stopped and then left alone. It is not restarted here: the next reconcile finds it stopped and starts it against the new allowlist, so the stop and the start are two decisions and the machine is never running on an address nobody checked.
            if state == STATE_RUNNING {
                return doing(STATE_STOPPING);
            }
            return None;
        }
    }

    match state {
        STATE_ABSENT => doing(STATE_CREATING),
        STATE_STOPPED => doing(STATE_STARTING),
        STATE_RUNNING => {
            if applied.is_none_or(|applied| needs_restart(applied, desired)) {
                return doing(STATE_RESTARTING);
            }
            if !ready && dead_for_long {
                return Some(Plan {
                    op: STATE_RESTARTING,
                    unhealthy: true,
                });
            }
            None
        }
        _ => None,
    }
}

// UNIT_BOUNDARY_DESCRIPTION: whether the machine has to be stopped and started to become what is asked. Storage is the one field compared as an inequality rather than for difference: a disk can be grown and cannot be shrunk, so a smaller request is not drift, it is a request the machine already satisfies.
pub fn needs_restart(applied: &MachineSpec, desired: &MachineSpec) -> bool {
    applied.revision != desired.revision
        || applied.ca_cert != desired.ca_cert
        || applied.cpus != desired.cpus
        || applied.memory_mib != desired.memory_mib
        || applied.storage_gib < desired.storage_gib
        || applied.env != desired.env
}

// UNIT_BOUNDARY_DESCRIPTION: the one difference the runner reports and does not act on. The image is fixed when the machine is created, because changing it would mean a new root filesystem under the disk the agent's work lives on — so a changed image is said out loud, in the machine's status, rather than silently kept or silently applied.
pub fn create_only_drift(applied: &MachineSpec, desired: &MachineSpec) -> Option<String> {
    if applied.image == desired.image {
        return None;
    }
    Some(format!(
        "the image is fixed at create, so this machine keeps what it has (recreate the agent to change it): image is {}, wanted {}",
        applied.image, desired.image
    ))
}

// UNIT_BOUNDARY_DESCRIPTION: the allowlist is the paired gateway's ClusterIP, and Kubernetes reuses those — a machine still holding an address its gateway no longer owns may be pointing at another owner's gateway, so it is stopped rather than run on.
pub fn egress_changed(applied: &MachineSpec, desired: &MachineSpec) -> bool {
    applied.allow_cidrs != desired.allow_cidrs
}

// UNIT_BOUNDARY_DESCRIPTION: the fields without which a machine cannot be created, refused at the door rather than part-way through a boot. Only a machine that is meant to run has to be complete: a request that stops one carries no shape, and requiring one would make stopping a machine impossible for a controller that has forgotten what it was.
pub const REQUIRED: &str = "image, cpus, memoryMiB and storageGiB are required";

pub const BAD_IMAGE: &str = "invalid image reference";

pub fn admissible(spec: &MachineSpec) -> Result<(), &'static str> {
    if spec.running
        && (spec.image.is_empty() || spec.cpus < 1 || spec.memory_mib < 1 || spec.storage_gib < 1)
    {
        return Err(REQUIRED);
    }
    if !spec.image.is_empty() && (!is_image_ref(&spec.image) || spec.image.contains("..")) {
        return Err(BAD_IMAGE);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gosource;

    // TEST_SCENARIO: the window a quiet machine is given before the runner gives up on it. Both runners restart on this rule, and during a rollout both are looking at the same machines: a shorter window on one side restarts a machine the other was still waiting for, and the agent loses its turn to a runner that was not even asked.
    #[test]
    fn the_go_runner_gives_a_quiet_machine_the_same_window() {
        let go = gosource::read("server.go");
        assert_eq!(
            gosource::duration_value(&go, "unhealthyRestart"),
            Some(UNHEALTHY_RESTART),
            "the two runners no longer agree how long a machine may be quiet"
        );
    }

    // TEST_SCENARIO: these three strings leave the runner. The drift message is written into the machine's status and reaches a person reading why their agent still runs the old image; the two refusals are the body of a 400 the controller surfaces. A rollout answers the same request with either runner, so two wordings for one condition is a support question that starts with which runner answered.
    #[test]
    fn the_refusals_and_the_drift_message_read_as_the_go_runners_do() {
        let go = gosource::read("server.go");

        let drift: Vec<String> = gosource::literals_in(&go, "createOnlyDrift")
            .into_iter()
            .filter(|literal| literal.contains("%s"))
            .collect();
        let [format] = drift.as_slice() else {
            panic!(
                "createOnlyDrift no longer holds exactly one message with a verb in it: {drift:?}"
            )
        };
        let theirs = format
            .replacen("%s", "quay.io/x/vm:1", 1)
            .replacen("%s", "quay.io/x/vm:2", 1);
        assert_eq!(
            create_only_drift(
                &spec_with_image("quay.io/x/vm:1"),
                &spec_with_image("quay.io/x/vm:2")
            ),
            Some(theirs),
            "the two runners explain a changed image differently"
        );

        let put = gosource::literals_in(&go, "(s *Server) put");
        for refusal in [REQUIRED, BAD_IMAGE] {
            assert!(
                put.iter().any(|literal| literal == refusal),
                "put no longer refuses with {refusal:?}, so the two runners answer a bad request differently"
            );
        }
    }

    // TEST_SCENARIO: the reconcile arrives about once a minute with the same desired shape, so the common answer must be silence. A decision that acts on a machine that is already right restarts every agent on the node, once a minute, for as long as nobody notices.
    #[test]
    fn a_machine_that_is_already_what_it_should_be_is_left_alone() {
        let applied = running_spec();
        assert_eq!(
            plan(Some(&applied), &applied, STATE_RUNNING, true, false),
            None
        );
    }

    // TEST_SCENARIO: the two directions a machine is taken in when it is not where it should be, and the in-between states in which the answer is to wait. An operation already running is reported as the machine's state, so planning over it again is how one machine ends up with two creates.
    #[test]
    fn a_machine_is_moved_towards_what_was_asked_and_never_twice_at_once() {
        let want = running_spec();

        assert_eq!(
            plan(None, &want, STATE_ABSENT, false, false).map(|p| p.op),
            Some(STATE_CREATING)
        );
        assert_eq!(
            plan(Some(&want), &want, STATE_STOPPED, false, false).map(|p| p.op),
            Some(STATE_STARTING)
        );

        for busy in [
            STATE_CREATING,
            STATE_STARTING,
            STATE_RESTARTING,
            STATE_STOPPING,
        ] {
            assert_eq!(
                plan(Some(&want), &want, busy, false, false),
                None,
                "{busy} is an operation already running and was planned over"
            );
        }
    }

    // TEST_SCENARIO: a stop has to reach a machine in any state a machine can be caught in, including the middle of its own boot — a create that is still running reports as `creating`, and a stop dropped there leaves a machine nobody believes is running and nobody stops. It must also be silent about a machine that is already down, or the runner stops the same machine every minute.
    #[test]
    fn a_stop_reaches_a_machine_caught_mid_boot_and_leaves_a_stopped_one_alone() {
        let stop = MachineSpec {
            running: false,
            ..running_spec()
        };

        for busy in [
            STATE_RUNNING,
            STATE_CREATING,
            STATE_STARTING,
            STATE_RESTARTING,
        ] {
            assert_eq!(
                plan(Some(&stop), &stop, busy, false, false).map(|p| p.op),
                Some(STATE_STOPPING),
                "a machine in {busy} was left running"
            );
        }

        for down in [STATE_ABSENT, STATE_STOPPED, STATE_STOPPING] {
            assert_eq!(
                plan(Some(&stop), &stop, down, false, false),
                None,
                "{down} was stopped again"
            );
        }
    }

    // TEST_SCENARIO: the allowlist is the paired gateway's ClusterIP and Kubernetes reuses those, so a machine holding a stale one may be reaching another owner's gateway. It is stopped and then left alone: the next reconcile finds it stopped and starts it against the new allowlist, which keeps the stop and the start two decisions rather than a restart that races its own check.
    #[test]
    fn a_machine_whose_allowlist_moved_is_stopped_before_anything_else_is_considered() {
        let applied = running_spec();
        let desired = MachineSpec {
            allow_cidrs: vec!["10.0.0.9/32".into()],
            revision: "2".into(),
            ..running_spec()
        };

        assert_eq!(
            plan(Some(&applied), &desired, STATE_RUNNING, true, false).map(|p| p.op),
            Some(STATE_STOPPING),
            "a machine kept running on an address its gateway may no longer own"
        );
        assert_eq!(
            plan(Some(&applied), &desired, STATE_STOPPED, false, false),
            None,
            "it was started again before the allowlist change was applied"
        );
        assert_eq!(
            plan(Some(&applied), &desired, STATE_ABSENT, false, false).map(|p| p.op),
            Some(STATE_CREATING),
            "a machine that does not exist has no stale allowlist to hold"
        );
    }

    // TEST_SCENARIO: every field that cannot be changed under a running machine, and the one that can. Storage is compared as an inequality because a disk grows and does not shrink, so a smaller request is a request the machine already satisfies — restarting for it would take an agent down to give it nothing.
    #[test]
    fn a_shape_that_cannot_be_changed_in_place_restarts_the_machine() {
        let applied = running_spec();

        let changes = [
            (
                "revision",
                MachineSpec {
                    revision: "2".into(),
                    ..running_spec()
                },
            ),
            (
                "caCert",
                MachineSpec {
                    ca_cert: "rotated".into(),
                    ..running_spec()
                },
            ),
            (
                "cpus",
                MachineSpec {
                    cpus: 4,
                    ..running_spec()
                },
            ),
            (
                "memoryMiB",
                MachineSpec {
                    memory_mib: 4096,
                    ..running_spec()
                },
            ),
            (
                "storageGiB up",
                MachineSpec {
                    storage_gib: 20,
                    ..running_spec()
                },
            ),
            (
                "env",
                MachineSpec {
                    env: [("A".to_string(), "2".to_string())].into_iter().collect(),
                    ..running_spec()
                },
            ),
        ];
        for (what, desired) in changes {
            assert!(
                needs_restart(&applied, &desired),
                "{what} was applied in place"
            );
            assert_eq!(
                plan(Some(&applied), &desired, STATE_RUNNING, true, false).map(|p| p.op),
                Some(STATE_RESTARTING)
            );
        }

        let smaller = MachineSpec {
            storage_gib: 1,
            ..running_spec()
        };
        assert!(
            !needs_restart(&applied, &smaller),
            "a disk cannot shrink, so a smaller request is already satisfied"
        );

        let other_image = spec_with_image("quay.io/x/other:1");
        assert!(
            !needs_restart(&applied, &other_image),
            "the image is fixed at create and must never be a reason to restart"
        );
    }

    // TEST_SCENARIO: a machine the runner has no spec for is one it cannot prove is right, which is the state a runner is in after it restarts having lost a spec, or after a partial create. Reshaping it is the safe answer — leaving it alone would strand a machine in whatever shape it happens to have, forever.
    #[test]
    fn a_running_machine_with_no_spec_on_disk_is_reshaped_rather_than_trusted() {
        assert_eq!(
            plan(None, &running_spec(), STATE_RUNNING, true, false).map(|p| p.op),
            Some(STATE_RESTARTING)
        );
    }

    // TEST_SCENARIO: the machine the runner gives up on. Both halves of the condition carry weight: a machine that never answered is still booting and must be given as long as it needs, and a machine that answered a moment ago is simply between checks. The restart is marked unhealthy because it is the runner's decision rather than the controller's, and only the runner's are worth counting.
    #[test]
    fn a_machine_that_answered_once_and_then_went_quiet_is_restarted_and_said_to_be_unhealthy() {
        let want = running_spec();

        assert_eq!(
            plan(Some(&want), &want, STATE_RUNNING, false, true),
            Some(Plan {
                op: STATE_RESTARTING,
                unhealthy: true
            })
        );
        assert_eq!(
            plan(Some(&want), &want, STATE_RUNNING, false, false),
            None,
            "a machine that has not been quiet for long enough was restarted"
        );
        assert_eq!(
            plan(Some(&want), &want, STATE_RUNNING, true, true),
            None,
            "a machine that is answering was restarted for being quiet"
        );
    }

    // TEST_SCENARIO: how the quiet window is measured. A machine that has never answered is still booting, however long that takes; one that answers again has its quiet mark cleared, or a machine that recovered on its own would still be restarted for the silence it has already come out of.
    #[test]
    fn the_quiet_window_starts_at_the_first_silence_and_ends_at_the_next_answer() {
        let start = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let later = |after: Duration| start + after;

        let mut never_answered = Health::default();
        never_answered.observed_running(false, start);
        assert!(
            !never_answered.dead_for_long(later(UNHEALTHY_RESTART * 10)),
            "a machine that has never answered is still booting"
        );

        let mut quiet = Health::default();
        quiet.observed_running(true, start);
        quiet.observed_running(false, later(Duration::from_secs(1)));
        assert!(!quiet.dead_for_long(later(UNHEALTHY_RESTART)));
        assert!(quiet.dead_for_long(later(UNHEALTHY_RESTART + Duration::from_secs(2))));

        quiet.observed_running(false, later(Duration::from_secs(5)));
        assert!(
            quiet.dead_for_long(later(UNHEALTHY_RESTART + Duration::from_secs(2))),
            "the window restarted at a later silence instead of the first"
        );

        quiet.observed_running(true, later(UNHEALTHY_RESTART));
        assert!(
            !quiet.dead_for_long(later(UNHEALTHY_RESTART * 3)),
            "a machine that came back was restarted for the silence it came out of"
        );
    }

    // TEST_SCENARIO: an answer is only believed from a machine on its way up. A restart's old guest answers until the stop lands and a stopping machine answers until it dies, so believing either would report a machine as ready on the strength of the one that is going away.
    #[test]
    fn an_answer_is_believed_only_from_a_machine_on_its_way_up() {
        for up in [STATE_RUNNING, STATE_CREATING, STATE_STARTING] {
            assert!(reads_ready(up), "{up} is a machine whose answer counts");
        }
        for going in [
            STATE_RESTARTING,
            STATE_STOPPING,
            STATE_STOPPED,
            STATE_ABSENT,
            "unknown",
        ] {
            assert!(
                !reads_ready(going),
                "{going} would report the guest that is going away as ready"
            );
        }
    }

    // TEST_SCENARIO: what is refused at the door. A machine that is meant to run needs a complete shape, and an image reference is checked on the way in as well as on the way out — a request is the one place a `..` can still be chosen by somebody. A request that stops a machine carries no shape and must not need one, or a controller that has forgotten a machine cannot stop it.
    #[test]
    fn a_request_that_could_not_produce_a_machine_is_refused_at_the_door() {
        assert_eq!(admissible(&running_spec()), Ok(()));

        for (what, spec) in [
            (
                "no image",
                MachineSpec {
                    image: String::new(),
                    ..running_spec()
                },
            ),
            (
                "no cpus",
                MachineSpec {
                    cpus: 0,
                    ..running_spec()
                },
            ),
            (
                "no memory",
                MachineSpec {
                    memory_mib: 0,
                    ..running_spec()
                },
            ),
            (
                "no storage",
                MachineSpec {
                    storage_gib: 0,
                    ..running_spec()
                },
            ),
        ] {
            assert_eq!(admissible(&spec), Err(REQUIRED), "{what} was admitted");
        }

        for escape in ["../../etc/passwd", "quay.io/x/../../../vm:1", "has space"] {
            assert_eq!(
                admissible(&spec_with_image(escape)),
                Err(BAD_IMAGE),
                "{escape} was admitted"
            );
        }

        let stop = MachineSpec {
            running: false,
            ..Default::default()
        };
        assert_eq!(
            admissible(&stop),
            Ok(()),
            "a machine could not be stopped without restating what it is"
        );
        assert_eq!(
            admissible(&MachineSpec {
                running: false,
                image: "has space".into(),
                ..Default::default()
            }),
            Err(BAD_IMAGE),
            "a reference is checked whatever the request is for"
        );
    }

    fn running_spec() -> MachineSpec {
        MachineSpec {
            image: "quay.io/x/vm:1".into(),
            cpus: 2,
            memory_mib: 2048,
            storage_gib: 10,
            env: [("A".to_string(), "1".to_string())].into_iter().collect(),
            ca_cert: "ca".into(),
            allow_cidrs: vec!["10.0.0.7/32".into()],
            revision: "1".into(),
            running: true,
        }
    }

    fn spec_with_image(image: &str) -> MachineSpec {
        MachineSpec {
            image: image.into(),
            ..running_spec()
        }
    }
}
