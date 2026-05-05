package lifecycle

import (
	"context"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/util/retry"
	"gopkg.in/yaml.v3"

	"github.com/kagenti/platform/packages/controller/pkg/types"
)

// Annotation keys. Kept local to avoid a cross-package dependency on the
// reconciler; string literal is the contract.
const (
	lastActivityAnnotation = "agent-platform.ai/last-activity"
)

// wakeIfHibernated flips the instance's desiredState from "hibernated" to
// "running" if currently hibernated. No-op if desiredState is anything else.
// Uses K8s optimistic-concurrency retry to handle racing writers.
func (l *Lifecycle) wakeIfHibernated(ctx context.Context, instanceName string) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		cm, err := l.client.CoreV1().ConfigMaps(l.namespace).Get(ctx, instanceName, metav1.GetOptions{})
		if err != nil {
			return err
		}
		spec, err := types.ParseInstanceSpec(cm.Data["spec.yaml"])
		if err != nil {
			return err
		}
		if spec.DesiredState != "hibernated" {
			return nil
		}
		spec.DesiredState = "running"
		specYAML, err := yaml.Marshal(spec)
		if err != nil {
			return err
		}
		cm.Data["spec.yaml"] = string(specYAML)
		if cm.Annotations == nil {
			cm.Annotations = make(map[string]string)
		}
		cm.Annotations[lastActivityAnnotation] = time.Now().UTC().Format(time.RFC3339)
		_, err = l.client.CoreV1().ConfigMaps(l.namespace).Update(ctx, cm, metav1.UpdateOptions{})
		return err
	})
}

// bumpLastActivity updates agent-platform.ai/last-activity to now. Called on every
// successful EnsureReady, so any caller (schedule fire, UI WS open, channel
// message) keeps the pod warm and delays the idle-checker's hibernation.
func (l *Lifecycle) bumpLastActivity(ctx context.Context, instanceName string) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		cm, err := l.client.CoreV1().ConfigMaps(l.namespace).Get(ctx, instanceName, metav1.GetOptions{})
		if err != nil {
			return err
		}
		if cm.Annotations == nil {
			cm.Annotations = make(map[string]string)
		}
		cm.Annotations[lastActivityAnnotation] = time.Now().UTC().Format(time.RFC3339)
		_, err = l.client.CoreV1().ConfigMaps(l.namespace).Update(ctx, cm, metav1.UpdateOptions{})
		return err
	})
}
