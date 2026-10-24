package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"unicode"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// UNIT_BOUNDARY_DESCRIPTION: an Event on the Agent, so a state the controller reaches is visible in `kubectl get events` without reading its status. An Event that cannot be written is logged and never fails the step it describes.
func (r *AgentReconciler) agentEvent(ctx context.Context, agent *apiv1.Agent, eventType, reason, message string) {
	now := metav1.Now()
	event := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Name: fmt.Sprintf("%s.%x", agent.Name, now.UnixNano()), Namespace: r.config.Namespace},
		InvolvedObject: corev1.ObjectReference{
			APIVersion: agentGVK.GroupVersion().String(),
			Kind:       agentGVK.Kind,
			Name:       agent.Name,
			Namespace:  r.config.Namespace,
			UID:        agent.UID,
		},
		Reason:         reason,
		Message:        r.sanitizeFor(agent, message),
		Type:           eventType,
		Source:         corev1.EventSource{Component: "platform-controller"},
		FirstTimestamp: now,
		LastTimestamp:  now,
		Count:          1,
	}
	if _, err := r.client.CoreV1().Events(r.config.Namespace).Create(ctx, event, metav1.CreateOptions{}); err != nil {
		slog.Warn("writing an event on the agent failed", "agent", agent.Name, "reason", reason, "error", err)
	}
}

func (r *AgentReconciler) sanitizeFor(agent *apiv1.Agent, msg string) string {
	host := ""
	if owner := agent.Labels[envoyOwnerLabel]; owner != "" {
		host = r.runnerHost(owner)
	}
	return sanitizeAgentMessage(msg, host)
}

const agentMessageMax = 300

var (
	eventURLPattern  = regexp.MustCompile(`https?://[^\s()"';,]+`)
	eventAddrPattern = regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b`)
)

// UNIT_BOUNDARY_DESCRIPTION: an Event's message is shown to the user and partly written by what read the Agent's own data, so a crafted name could carry terminal escapes or text-direction overrides. Every control and formatting character is escaped rather than rendered, invalid UTF-8 is replaced, the runner's in-cluster address — its URL, host or any IP — becomes a fixed phrase, and the whole is cut to a length a status line can hold.
func sanitizeAgentMessage(msg, runnerHost string) string {
	const runnerPhrase = "the owner's VM runner"
	msg = strings.ToValidUTF8(msg, "\uFFFD")
	if runnerHost != "" {
		msg = eventURLPattern.ReplaceAllStringFunc(msg, func(u string) string {
			if strings.Contains(u, runnerHost) {
				return runnerPhrase
			}
			return u
		})
		msg = regexp.MustCompile(regexp.QuoteMeta(runnerHost)+`(?::\d+)?`).ReplaceAllString(msg, runnerPhrase)
	}
	msg = eventAddrPattern.ReplaceAllString(msg, "an in-cluster address")
	var b strings.Builder
	for _, c := range msg {
		switch {
		case c == '\n' || c == '\t':
			b.WriteByte(' ')
		case unicode.IsControl(c) || unicode.Is(unicode.Cf, c):
			fmt.Fprintf(&b, "\\u%04x", c)
		default:
			b.WriteRune(c)
		}
	}
	out := strings.TrimSpace(b.String())
	if runes := []rune(out); len(runes) > agentMessageMax {
		out = string(runes[:agentMessageMax]) + "…"
	}
	return out
}
