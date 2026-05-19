package types

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Agent ---

const fixtureTemplateYAML = `version: agent-platform.ai/v1
image: ghcr.io/myorg/claude-code:latest
description: "Persistent agent for repo monitoring"
mounts:
  - path: /home/agent
    persist: true
  - path: /tmp
    persist: false
init: |
  #!/bin/bash
  if [ -f /home/agent/requirements.txt ]; then
    pip install -r /home/agent/requirements.txt
  fi
env:
  - name: ACP_PORT
    value: "8080"
resources:
  requests:
    cpu: "250m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "2Gi"
imagePullPolicy: Always
storageSize: "5Gi"
skillPaths:
  - $HOME/.claude/skills/
`

func TestParseAgentSpec(t *testing.T) {
	spec, err := ParseAgentSpec(fixtureTemplateYAML)
	require.NoError(t, err)
	assert.Equal(t, SpecVersion, spec.Version)
	assert.Equal(t, "ghcr.io/myorg/claude-code:latest", spec.Image)
	assert.Equal(t, "Persistent agent for repo monitoring", spec.Description)
	assert.Len(t, spec.Mounts, 2)
	assert.True(t, spec.Mounts[0].Persist)
	assert.Equal(t, "/home/agent", spec.Mounts[0].Path)
	assert.False(t, spec.Mounts[1].Persist)
	assert.Contains(t, spec.Init, "pip install")
	assert.Len(t, spec.Env, 1)
	assert.Equal(t, "ACP_PORT", spec.Env[0].Name)
	assert.Equal(t, "250m", spec.Resources.Requests["cpu"])
	assert.Equal(t, "2Gi", spec.Resources.Limits["memory"])
	// Layer B overrides for AgentTemplateDefaults.
	assert.Equal(t, "Always", spec.ImagePullPolicy)
	assert.Equal(t, "5Gi", spec.StorageSize)
	assert.Equal(t, []string{"$HOME/.claude/skills/"}, spec.SkillPaths)
}

// Minimal agent ConfigMap: image only. The controller fills the rest from
// chart-wide AgentTemplateDefaults at reconcile time. Used for the bare-image
// agent path the api-server creates.
func TestParseAgentSpec_BareImage(t *testing.T) {
	spec, err := ParseAgentSpec(`version: agent-platform.ai/v1
image: foo
`)
	require.NoError(t, err)
	assert.Equal(t, "foo", spec.Image)
	assert.Empty(t, spec.Mounts)
	assert.Empty(t, spec.Env)
	assert.Empty(t, spec.ImagePullPolicy)
	assert.Empty(t, spec.StorageSize)
}

func TestParseAgentSpec_MissingVersion(t *testing.T) {
	_, err := ParseAgentSpec(`image: ghcr.io/myorg/agent:latest`)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "version is required")
}

func TestParseAgentSpec_WrongVersion(t *testing.T) {
	_, err := ParseAgentSpec("version: agent-platform.ai/v99\nimage: foo")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported version")
}

func TestParseAgentSpec_MissingImage(t *testing.T) {
	_, err := ParseAgentSpec(`version: agent-platform.ai/v1
description: "no image"`)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "image")
}

func TestParseAgentSpec_RelativeMountPath(t *testing.T) {
	_, err := ParseAgentSpec(`version: agent-platform.ai/v1
image: foo
mounts:
  - path: workspace
    persist: true`)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "must be absolute")
}

func TestParseAgentSpec_MountSize(t *testing.T) {
	spec, err := ParseAgentSpec(`version: agent-platform.ai/v1
image: foo
mounts:
  - path: /home/agent
    persist: true
    size: 2Gi
  - path: /tmp
    persist: false`)
	require.NoError(t, err)
	require.Len(t, spec.Mounts, 2)
	assert.Equal(t, "2Gi", spec.Mounts[0].Size)
	assert.Empty(t, spec.Mounts[1].Size)
}

func TestParseAgentSpec_MountSizeInvalid(t *testing.T) {
	_, err := ParseAgentSpec(`version: agent-platform.ai/v1
image: foo
mounts:
  - path: /home/agent
    persist: true
    size: notaquantity`)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "valid K8s quantity")
}

// --- Agent runtime fields (ADR-046) ---

// ParseAgentSpec must accept the merged runtime fields (desiredState, env,
// secretRef) that formerly lived on InstanceSpec. The merged Agent CM is
// the sole durable resource per agent.
func TestParseAgentSpec_RuntimeFields(t *testing.T) {
	spec, err := ParseAgentSpec(`version: agent-platform.ai/v1
image: ghcr.io/myorg/claude-code:latest
desiredState: running
env:
  - name: GITHUB_ORG
    value: "team-alpha"
secretRef: cg-team-alpha-secrets
`)
	require.NoError(t, err)
	assert.Equal(t, SpecVersion, spec.Version)
	assert.Equal(t, "running", spec.DesiredState)
	assert.Equal(t, "cg-team-alpha-secrets", spec.SecretRef)
	assert.Len(t, spec.Env, 1)
}

func TestParseAgentSpec_InvalidDesiredState(t *testing.T) {
	_, err := ParseAgentSpec(`version: agent-platform.ai/v1
image: foo
desiredState: paused`)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "'running' or 'hibernated'")
}

func TestParseAgentSpec_DesiredStateOptional(t *testing.T) {
	// Omitted desiredState is allowed; the reconciler defaults it to "running".
	spec, err := ParseAgentSpec(`version: agent-platform.ai/v1
image: foo`)
	require.NoError(t, err)
	assert.Empty(t, spec.DesiredState)
}

// --- Schedule ---

func TestParseScheduleSpec(t *testing.T) {
	spec, err := ParseScheduleSpec(`version: agent-platform.ai/v1
type: cron
cron: "*/30 * * * *"
task: ""
enabled: true
`)
	require.NoError(t, err)
	assert.Equal(t, SpecVersion, spec.Version)
	assert.Equal(t, "cron", spec.Type)
	assert.Equal(t, "*/30 * * * *", spec.Cron)
	assert.True(t, spec.Enabled)
}

func TestParseScheduleSpec_InvalidCron(t *testing.T) {
	_, err := ParseScheduleSpec(`version: agent-platform.ai/v1
cron: "not a cron"
enabled: true`)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid cron")
}

func TestParseScheduleSpec_MissingVersion(t *testing.T) {
	_, err := ParseScheduleSpec(`cron: "* * * * *"
enabled: true`)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "version is required")
}

func TestParseScheduleSpecWithSessionMode(t *testing.T) {
	yaml := `
version: agent-platform.ai/v1
type: cron
cron: "*/5 * * * *"
task: "check health"
enabled: true
sessionMode: continuous
`
	spec, err := ParseScheduleSpec(yaml)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if spec.SessionMode != "continuous" {
		t.Errorf("sessionMode = %q, want %q", spec.SessionMode, "continuous")
	}
}

func TestParseScheduleSpecSessionModeDefaults(t *testing.T) {
	yaml := `
version: agent-platform.ai/v1
type: cron
cron: "*/5 * * * *"
enabled: true
`
	spec, err := ParseScheduleSpec(yaml)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if spec.SessionMode != "" {
		t.Errorf("sessionMode = %q, want empty (default)", spec.SessionMode)
	}
}

// --- Helpers ---

func TestSanitizeMountName(t *testing.T) {
	tests := []struct {
		path     string
		expected string
	}{
		{"/workspace", "workspace"},
		{"/home/agent", "home-agent"},
		{"/tmp", "tmp"},
		{"/var/lib/data", "var-lib-data"},
	}
	for _, tt := range tests {
		assert.Equal(t, tt.expected, SanitizeMountName(tt.path))
	}
}

func TestNewAgentStatus(t *testing.T) {
	s := NewAgentStatus("running", "")
	assert.Equal(t, SpecVersion, s.Version)
	assert.Equal(t, "running", s.CurrentState)
}

func TestNewScheduleStatus(t *testing.T) {
	s := NewScheduleStatus("2026-04-01T14:00:00Z", "2026-04-01T14:30:00Z", "success")
	assert.Equal(t, SpecVersion, s.Version)
	assert.Equal(t, "success", s.LastResult)
}

// --- Fork ---

const fixtureForkYAML = `version: agent-platform.ai/v1
agentName: agent-abc
foreignSub: kc|user-42
sessionId: sess-1
`

func TestParseForkSpec(t *testing.T) {
	spec, err := ParseForkSpec(fixtureForkYAML)
	require.NoError(t, err)
	assert.Equal(t, SpecVersion, spec.Version)
	assert.Equal(t, "agent-abc", spec.AgentName)
	assert.Equal(t, "kc|user-42", spec.ForeignSub)
	assert.Equal(t, "sess-1", spec.SessionID)
}

func TestParseForkSpec_Minimal(t *testing.T) {
	spec, err := ParseForkSpec(`version: agent-platform.ai/v1
agentName: agent-abc
foreignSub: kc|user-42
`)
	require.NoError(t, err)
	assert.Empty(t, spec.SessionID)
}

func TestParseForkSpec_MissingRequired(t *testing.T) {
	cases := map[string]string{
		"missing agentName":  `version: agent-platform.ai/v1` + "\n" + `foreignSub: kc|u`,
		"missing foreignSub": `version: agent-platform.ai/v1` + "\n" + `agentName: agent-abc`,
	}
	for name, yaml := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := ParseForkSpec(yaml)
			assert.Error(t, err)
		})
	}
}

func TestNewForkStatus(t *testing.T) {
	s := NewForkStatus(ForkPhaseReady, "fork-job-1", "10.0.0.5", nil)
	assert.Equal(t, SpecVersion, s.Version)
	assert.Equal(t, ForkPhaseReady, s.Phase)
	assert.Equal(t, "10.0.0.5", s.PodIP)
	assert.Nil(t, s.Error)

	f := NewForkStatus(ForkPhaseFailed, "", "", &ForkError{Reason: ForkReasonPodNotReady, Detail: "timeout"})
	assert.Equal(t, ForkPhaseFailed, f.Phase)
	require.NotNil(t, f.Error)
	assert.Equal(t, ForkReasonPodNotReady, f.Error.Reason)
}
