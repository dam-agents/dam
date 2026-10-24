package reconciler

import (
	"strings"

	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// UNIT_BOUNDARY_DESCRIPTION: a condition message carries text from outside the controller, such as a VM runner's error body or a proxy's HTML error page in front of it. The API server refuses a condition message over 32 KiB, so an uncapped one would fail every status write and loop the reconcile; the message is capped well under that.
const conditionMessageMax = 4096

func setStatusCondition(s *apiv1.AgentStatus, condType string, ok bool, trueReason, falseReason, message string, generation int64) {
	status := metav1.ConditionFalse
	reason := falseReason
	if ok {
		status = metav1.ConditionTrue
		reason = trueReason
	}
	if len(message) > conditionMessageMax {
		message = strings.ToValidUTF8(message[:conditionMessageMax], "") + "…"
	}
	apimeta.SetStatusCondition(&s.Conditions, metav1.Condition{
		Type:               condType,
		Status:             status,
		Reason:             reason,
		Message:            message,
		ObservedGeneration: generation,
	})
}
