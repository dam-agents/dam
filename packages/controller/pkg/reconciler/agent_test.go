package reconciler

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const fixtureAgentYAML = `version: agent-platform.ai/v1
image: ghcr.io/myorg/claude-code:latest
description: "Persistent agent for repo monitoring"
mounts:
  - path: /home/agent
    persist: true
  - path: /tmp
    persist: false
init: |
  #!/bin/bash
  echo hello
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
securityContext:
  runAsNonRoot: true
  readOnlyRootFilesystem: false
`

// fakeGetter implements AgentGetter for tests
type fakeGetter struct {
	cms map[string]*corev1.ConfigMap
}

func (f *fakeGetter) Get(name string) (*corev1.ConfigMap, error) {
	cm, ok := f.cms[name]
	if !ok {
		return nil, fmt.Errorf("not found: %s", name)
	}
	return cm, nil
}

func TestResolveAgent(t *testing.T) {
	getter := &fakeGetter{cms: map[string]*corev1.ConfigMap{
		"claude-code": {
			ObjectMeta: metav1.ObjectMeta{Name: "claude-code", Namespace: "test-agents", UID: "agent-uid"},
			Data:       map[string]string{"spec.yaml": fixtureAgentYAML},
		},
	}}
	resolver := NewAgentResolver(getter)
	cm, spec, err := resolver.Resolve("claude-code")
	require.NoError(t, err)
	assert.Equal(t, "claude-code", cm.Name)
	assert.EqualValues(t, "agent-uid", cm.UID)
	assert.Equal(t, "ghcr.io/myorg/claude-code:latest", spec.Image)
	assert.Len(t, spec.Mounts, 2)
}

func TestResolveAgent_NotFound(t *testing.T) {
	resolver := NewAgentResolver(&fakeGetter{cms: map[string]*corev1.ConfigMap{}})
	_, _, err := resolver.Resolve("missing")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestResolveAgent_NoSpecYAML(t *testing.T) {
	getter := &fakeGetter{cms: map[string]*corev1.ConfigMap{
		"bad-agent": {
			ObjectMeta: metav1.ObjectMeta{Name: "bad-agent", Namespace: "test-agents"},
			Data:       map[string]string{"other": "data"},
		},
	}}
	resolver := NewAgentResolver(getter)
	_, _, err := resolver.Resolve("bad-agent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no spec.yaml")
}
