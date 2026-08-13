package crdcheck

import (
	"context"
	"fmt"
	"strconv"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
)

var crdGVR = schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"}

func Assert(ctx context.Context, client dynamic.Interface) error {
	required := map[string]int{
		"agents." + apiv1.GroupVersion.Group:      apiv1.AgentSchemaGeneration,
		"userbudgets." + apiv1.GroupVersion.Group: apiv1.UserBudgetSchemaGeneration,
	}
	for name, want := range required {
		crd, err := client.Resource(crdGVR).Get(ctx, name, metav1.GetOptions{})
		if apierrors.IsNotFound(err) {
			return fmt.Errorf("CRD %s is not installed — install the chart CRDs before starting the controller", name)
		}
		if err != nil {
			return fmt.Errorf("reading CRD %s: %w", name, err)
		}
		got, _ := strconv.Atoi(crd.GetAnnotations()[apiv1.SchemaGenerationAnnotation])
		if got < want {
			return fmt.Errorf("CRD %s is at schema generation %d but this controller requires %d — run the operator CRD upgrade before deploying this release", name, got, want)
		}
	}
	return nil
}
