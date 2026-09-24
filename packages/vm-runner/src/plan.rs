use std::time::{Duration, SystemTime};

use crate::api::{MachineSpec, State};
use crate::state::is_image_ref;

// UNIT_BOUNDARY_DESCRIPTION: the next thing the runner does to bring one machine to the spec it was asked for, and nothing about doing it. The controller sends the whole desired spec on every reconcile, so this decision is made again and again against a machine that is already in some state. It is pure so that a wrong decision can be found without a hypervisor, before it restarts every agent once a minute.

// UNIT_BOUNDARY_DESCRIPTION: how long a machine that once answered may stay quiet before it is restarted. A machine that has never answered is still booting, and one that answered a moment ago is between checks, so both halves of the condition are needed.
pub const UNHEALTHY_RESTART: Duration = Duration::from_secs(10 * 60);

// UNIT_BOUNDARY_DESCRIPTION: how long a machine that has answered stays ready through missed probes: one interval of the prober's steady cadence, so the machine reads unready on the second consecutive miss and not the first. The probe is bounded to two seconds and a guest under nested virtualization, or on a busy node, takes one to two to answer, so a single miss says nothing about the guest — reporting it would flap the Agent's readiness and fail the deliveries riding on it. Quiet longer than UNHEALTHY_RESTART restarts.
pub const READY_GRACE: Duration = crate::server::STEADY_PROBE;

// UNIT_BOUNDARY_DESCRIPTION: one step towards the desired spec. Each step is whole: a start or a restart applies every change to the stopped machine — size, env, image and egress allowlist — before it boots, so one step is enough unless a newer spec arrives while it runs. `unhealthy` marks a restart the runner chose because the guest went quiet; only those are counted as the agent's restarts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Create,
    Start,
    Restart { unhealthy: bool },
    Stop,
}

impl Action {
    // UNIT_BOUNDARY_DESCRIPTION: the state a machine reports while this action runs on it.
    pub fn state(self) -> State {
        match self {
            Action::Create => State::Creating,
            Action::Start => State::Starting,
            Action::Restart { .. } => State::Restarting,
            Action::Stop => State::Stopping,
        }
    }

    pub fn label(self) -> &'static str {
        self.state().as_str()
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the health of one machine as the runner has seen it, read only while the machine reads as running.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Health {
    pub ever_ready: bool,
    pub quiet_since: Option<SystemTime>,
}

impl Health {
    // UNIT_BOUNDARY_DESCRIPTION: an answer resets everything, so a machine that recovered on its own is not restarted for the silence it came out of.
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

    // UNIT_BOUNDARY_DESCRIPTION: an action is starting on the machine, so the silence measured so far belongs to the guest it replaces. Without clearing it, the restart the silence caused would at once qualify for another. `ever_ready` stays, so the new guest can still be given up on later.
    pub fn action_started(&mut self) {
        self.quiet_since = None;
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether a machine that has answered is still reported ready: quiet, but for no longer than READY_GRACE. Asked only of a boot that has answered — before that a miss is the boot still running, not a guest gone quiet, and a restart's new guest must not be ready on the old one's answers.
    pub fn within_grace(&self, now: SystemTime) -> bool {
        self.ever_ready
            && self.quiet_since.is_some_and(|since| {
                now.duration_since(since)
                    .is_ok_and(|quiet| quiet <= READY_GRACE)
            })
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

// UNIT_BOUNDARY_DESCRIPTION: whether an answer from the guest may be believed in this state. A machine on its way up is believed, because the runtime's start call returns seconds after the guest begins to serve. A restart's old guest and a stopping one answer until they die, so they are not.
pub fn reads_ready(state: State) -> bool {
    matches!(state, State::Running | State::Creating | State::Starting)
}

// UNIT_BOUNDARY_DESCRIPTION: the next action for a machine, or none when it already is what was asked. `state` is what the runtime reports; an action already in flight is never planned over.
pub fn step(
    applied: Option<&MachineSpec>,
    desired: &MachineSpec,
    state: State,
    ready: bool,
    dead_for_long: bool,
) -> Option<Action> {
    if !desired.running {
        return (state == State::Running).then_some(Action::Stop);
    }
    match state {
        State::Absent => Some(Action::Create),
        State::Stopped => Some(Action::Start),
        State::Running if applied.is_none_or(|applied| changed(applied, desired)) => {
            Some(Action::Restart { unhealthy: false })
        }
        State::Running if !ready && dead_for_long => Some(Action::Restart { unhealthy: true }),
        _ => None,
    }
}

// UNIT_BOUNDARY_DESCRIPTION: whether the machine must be stopped and started to become what is asked. Storage is compared as an inequality: a disk grows and cannot shrink, so a smaller request is already met. The allowlist is the paired gateway's ClusterIP, and Kubernetes reuses those, so a machine holding an old one may reach another owner's gateway and must restart onto the new one.
pub fn changed(applied: &MachineSpec, desired: &MachineSpec) -> bool {
    applied.revision != desired.revision
        || applied.ca_cert != desired.ca_cert
        || applied.cpus != desired.cpus
        || applied.memory_mib != desired.memory_mib
        || applied.storage_gib < desired.storage_gib
        || applied.env != desired.env
        || applied.image != desired.image
        || applied.allow_cidrs != desired.allow_cidrs
}

// UNIT_BOUNDARY_DESCRIPTION: the fields without which a machine cannot be created, refused at the door. Only a machine meant to run needs them: a stop carries no shape, so a controller that forgot a machine can still stop it.
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

    const RESTART: Option<Action> = Some(Action::Restart { unhealthy: false });

    // TEST_SCENARIO: these two strings are the body of a 400 that the controller shows in the Agent's status, so an operator searches for their wording.
    #[test]
    fn the_refusals_keep_their_wording() {
        assert_eq!(
            REQUIRED,
            "image, cpus, memoryMiB and storageGiB are required"
        );
        assert_eq!(BAD_IMAGE, "invalid image reference");
    }

    // TEST_SCENARIO: the reconcile sends the same spec about once a minute, so the usual answer must be nothing. Acting on a machine that is already right restarts every agent once a minute.
    #[test]
    fn a_machine_that_is_already_what_it_should_be_is_left_alone() {
        let applied = running_spec();
        assert_eq!(
            step(Some(&applied), &applied, State::Running, true, false),
            None
        );
    }

    // TEST_SCENARIO: an absent machine is created and a stopped one started. An action already in flight is reported as the machine's state, and planning over it would run two actions on one machine.
    #[test]
    fn a_machine_is_moved_towards_what_was_asked_and_never_twice_at_once() {
        let want = running_spec();
        assert_eq!(
            step(None, &want, State::Absent, false, false),
            Some(Action::Create)
        );
        assert_eq!(
            step(Some(&want), &want, State::Stopped, false, false),
            Some(Action::Start)
        );
        for busy in [
            State::Creating,
            State::Starting,
            State::Restarting,
            State::Stopping,
            State::Unknown,
        ] {
            assert_eq!(
                step(Some(&want), &want, busy, false, false),
                None,
                "{busy} was planned over"
            );
        }
    }

    // TEST_SCENARIO: a running machine asked to stop is stopped, and one already down is left alone, or the runner stops the same machine every minute.
    #[test]
    fn a_stop_reaches_a_running_machine_and_leaves_a_stopped_one_alone() {
        let stop = MachineSpec {
            running: false,
            ..running_spec()
        };
        assert_eq!(
            step(Some(&stop), &stop, State::Running, true, false),
            Some(Action::Stop)
        );
        for down in [State::Absent, State::Stopped] {
            assert_eq!(
                step(Some(&stop), &stop, down, false, false),
                None,
                "{down} was stopped again"
            );
        }
    }

    // TEST_SCENARIO: every field that cannot change under a running guest restarts it, image and egress allowlist included: both are written to the stopped machine's record before it boots again, so the disk and port stay. A stopped machine with any of these changes is simply started, because a start applies them too.
    #[test]
    fn a_changed_shape_restarts_a_running_machine_and_starts_a_stopped_one() {
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
            (
                "image",
                MachineSpec {
                    image: "quay.io/x/vm:2".into(),
                    ..running_spec()
                },
            ),
            (
                "allowCidrs",
                MachineSpec {
                    allow_cidrs: vec!["10.0.0.9/32".into()],
                    ..running_spec()
                },
            ),
        ];
        for (what, desired) in changes {
            assert!(changed(&applied, &desired), "{what} was not a change");
            assert_eq!(
                step(Some(&applied), &desired, State::Running, true, false),
                RESTART,
                "{what}"
            );
            assert_eq!(
                step(Some(&applied), &desired, State::Stopped, false, false),
                Some(Action::Start),
                "a stopped machine with a new {what} was never started"
            );
        }
    }

    // TEST_SCENARIO: a disk grows and cannot shrink, so a smaller storage request is already met. Restarting for it would take an agent down to give it nothing.
    #[test]
    fn a_smaller_disk_is_not_a_change() {
        let smaller = MachineSpec {
            storage_gib: 1,
            ..running_spec()
        };
        assert!(!changed(&running_spec(), &smaller));
    }

    // TEST_SCENARIO: a running machine with no spec on disk cannot be shown to be right — a runner that lost the spec, or a create cut short. It is reshaped rather than trusted, or it keeps whatever shape it has forever.
    #[test]
    fn a_running_machine_with_no_spec_on_disk_is_reshaped_rather_than_trusted() {
        assert_eq!(
            step(None, &running_spec(), State::Running, true, false),
            RESTART
        );
    }

    // TEST_SCENARIO: the machine the runner gives up on. A machine that never answered is still booting, and one that answered a moment ago is between checks. The restart is marked unhealthy because the runner chose it, not the controller.
    #[test]
    fn a_machine_that_answered_once_and_then_went_quiet_is_restarted_and_said_to_be_unhealthy() {
        let want = running_spec();
        assert_eq!(
            step(Some(&want), &want, State::Running, false, true),
            Some(Action::Restart { unhealthy: true })
        );
        assert_eq!(
            step(Some(&want), &want, State::Running, false, false),
            None,
            "a machine not yet quiet for long enough was restarted"
        );
        assert_eq!(
            step(Some(&want), &want, State::Running, true, true),
            None,
            "a machine that answers was restarted for being quiet"
        );
    }

    // TEST_SCENARIO: the quiet window starts at the first silence and ends at the next answer. A machine that never answered is still booting however long it takes.
    #[test]
    fn the_quiet_window_starts_at_the_first_silence_and_ends_at_the_next_answer() {
        let start = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let later = |after: Duration| start + after;

        let mut never_answered = Health::default();
        never_answered.observed_running(false, start);
        assert!(!never_answered.dead_for_long(later(UNHEALTHY_RESTART * 10)));

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
        assert!(!quiet.dead_for_long(later(UNHEALTHY_RESTART * 3)));
    }

    // TEST_SCENARIO: a machine that answered is still ready for one steady probe interval of silence and not a moment longer; one that never answered gets no grace at all.
    #[test]
    fn a_missed_probe_is_forgiven_for_one_interval_after_an_answer() {
        let start = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let later = |after: Duration| start + after;

        let mut never_answered = Health::default();
        never_answered.observed_running(false, start);
        assert!(!never_answered.within_grace(start));

        let mut quiet = Health::default();
        quiet.observed_running(true, start);
        assert!(
            !quiet.within_grace(start),
            "an answering machine needs no grace"
        );
        quiet.observed_running(false, later(Duration::from_secs(1)));
        assert!(quiet.within_grace(later(Duration::from_secs(1) + READY_GRACE)));
        assert!(!quiet.within_grace(later(Duration::from_secs(2) + READY_GRACE)));
    }

    // TEST_SCENARIO: the restart that follows giving up on a machine must not at once qualify it for another. The quiet mark is cleared when the action starts, or the runner restarts the machine on every reconcile, forever.
    #[test]
    fn a_restart_does_not_leave_the_machine_qualifying_for_another_one() {
        let start = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let later = |after: Duration| start + after;
        let want = running_spec();

        let mut health = Health::default();
        health.observed_running(true, start);
        health.observed_running(false, later(Duration::from_secs(1)));
        let gave_up = later(UNHEALTHY_RESTART + Duration::from_secs(2));
        assert!(health.dead_for_long(gave_up));

        health.action_started();

        assert!(!health.dead_for_long(gave_up));
        assert_eq!(
            step(
                Some(&want),
                &want,
                State::Running,
                false,
                health.dead_for_long(gave_up)
            ),
            None
        );
        assert!(health.ever_ready);

        health.observed_running(false, later(UNHEALTHY_RESTART * 2));
        assert!(
            health.dead_for_long(later(UNHEALTHY_RESTART * 3 + Duration::from_secs(2))),
            "the window runs again from the silence after the restart"
        );
    }

    // TEST_SCENARIO: an answer is believed only from a machine on its way up. A restart's old guest and a stopping one answer until they die.
    #[test]
    fn an_answer_is_believed_only_from_a_machine_on_its_way_up() {
        for up in [State::Running, State::Creating, State::Starting] {
            assert!(reads_ready(up), "{up}");
        }
        for going in [
            State::Restarting,
            State::Stopping,
            State::Stopped,
            State::Absent,
            State::Unknown,
        ] {
            assert!(!reads_ready(going), "{going}");
        }
    }

    // TEST_SCENARIO: each action is reported, and counted in the metrics, under the state string the controller already knows.
    #[test]
    fn an_action_is_reported_as_the_state_the_controller_knows() {
        assert_eq!(Action::Create.label(), "creating");
        assert_eq!(Action::Start.label(), "starting");
        assert_eq!(Action::Restart { unhealthy: true }.label(), "restarting");
        assert_eq!(Action::Stop.label(), "stopping");
    }

    // TEST_SCENARIO: what is refused at the door. A machine meant to run needs a whole shape, and an image reference is checked here because a request is where a `..` can be chosen by somebody. A stop needs no shape.
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
            let spec = MachineSpec {
                image: escape.into(),
                ..running_spec()
            };
            assert_eq!(admissible(&spec), Err(BAD_IMAGE), "{escape} was admitted");
        }
        let stop = MachineSpec {
            running: false,
            ..Default::default()
        };
        assert_eq!(admissible(&stop), Ok(()));
        assert_eq!(
            admissible(&MachineSpec {
                running: false,
                image: "has space".into(),
                ..Default::default()
            }),
            Err(BAD_IMAGE)
        );
    }

    // TEST_SCENARIO: the stored spec never keeps the registry credential, and the controller sends one every reconcile. If that difference were a change, every machine that pulls with credentials would restart once a minute.
    #[test]
    fn a_registry_credential_is_never_a_reason_to_restart() {
        let desired = MachineSpec {
            pull_auths: vec!["{\"auths\":{}}".into()],
            ..running_spec()
        };
        assert!(!changed(&running_spec(), &desired));
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
            pull_auths: Vec::new(),
        }
    }
}
