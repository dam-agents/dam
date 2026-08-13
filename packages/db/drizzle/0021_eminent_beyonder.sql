-- The harness resolves its own model/mode/config options inside the sandbox, so
-- a stopped sandbox could show nothing for them. This holds the last known
-- values plus the model list the provider offered at capture time, letting the
-- config page render while the pod is down. Nullable with no default: null means
-- "nothing captured yet", which is exactly the never-run state.
ALTER TABLE "agents" ADD COLUMN "harness_config_snapshot" jsonb;
