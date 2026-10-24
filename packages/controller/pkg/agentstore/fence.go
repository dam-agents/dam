package agentstore

import (
	"context"
	"fmt"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

const (
	ModeCRD      = "crd"
	ModePostgres = "postgres"
)

// UNIT_BOUNDARY_DESCRIPTION: ReadsPostgres is true from the release that reconciles the rows. An older
// UNIT_BOUNDARY_DESCRIPTION: build that still says false refuses the postgres mode, which is how a
// UNIT_BOUNDARY_DESCRIPTION: rollback target that predates the readers is kept off a switched cluster.
const ReadsPostgres = true

const (
	MarkerKey   = "store"
	KeyAbsorbed = "absorbed-at"
)

func MarkerName(releaseName string) string {
	return releaseName + "-agent-store"
}

func Refusal(mode string, marker map[string]string) string {
	return RefusalFor(mode, marker, ReadsPostgres)
}

func RefusalFor(mode string, marker map[string]string, readsPostgres bool) string {
	marked := marker[MarkerKey]
	switched := marked == ModePostgres

	switch mode {
	case ModeCRD:
		if switched {
			return "the Agent store has switched to Postgres: this build reconciles the custom resources, which nothing writes any more. Deploy the release that reads Postgres."
		}
		if marked != "" && marked != ModeCRD {
			return fmt.Sprintf("the Agent store's marker names %q, which this build does not know: it understands %q and %q only, and a store it cannot read is one it must not serve.", marked, ModeCRD, ModePostgres)
		}
		return ""
	case ModePostgres:
		if !readsPostgres {
			return "this build reconciles the custom resources and carries no Postgres reader, so it refuses the Agent store's Postgres mode whatever the cluster's marker says. Deploy the release that reads Postgres."
		}
		if !switched {
			return "the Agent store is configured as Postgres but the custom resources have not been absorbed into it, so there is nothing to reconcile. Deploy the release that absorbs them first."
		}
		if marker[KeyAbsorbed] == "" {
			return "the Agent store is configured as Postgres but the absorb did not complete: the store's absorbed-at stamp is missing from its marker."
		}
		return ""
	default:
		return fmt.Sprintf("unknown Agent store mode %q: expected %q or %q", mode, ModeCRD, ModePostgres)
	}
}

func ReadMarker(ctx context.Context, client kubernetes.Interface, namespace, name string) (map[string]string, error) {
	marker, err := client.CoreV1().ConfigMaps(namespace).Get(ctx, name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the Agent store marker: %w", err)
	}
	if marker.Data == nil {
		return nil, nil
	}
	return marker.Data, nil
}
