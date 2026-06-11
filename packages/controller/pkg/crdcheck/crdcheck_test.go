package crdcheck

import (
	"context"
	"strconv"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	dynfake "k8s.io/client-go/dynamic/fake"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
)

func crd(name string, annotations map[string]interface{}) *unstructured.Unstructured {
	obj := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apiextensions.k8s.io/v1",
		"kind":       "CustomResourceDefinition",
		"metadata": map[string]interface{}{
			"name": name,
		},
	}}
	if annotations != nil {
		obj.Object["metadata"].(map[string]interface{})["annotations"] = annotations
	}
	return obj
}

func bothCRDs(generation int) []runtime.Object {
	ann := map[string]interface{}{apiv1.SchemaGenerationAnnotation: strconv.Itoa(generation)}
	return []runtime.Object{
		crd("agents."+apiv1.GroupVersion.Group, ann),
		crd("forks."+apiv1.GroupVersion.Group, ann),
	}
}

func newClient(objs ...runtime.Object) *dynfake.FakeDynamicClient {
	return dynfake.NewSimpleDynamicClient(runtime.NewScheme(), objs...)
}

func TestAssertPassesOnMatchingGeneration(t *testing.T) {
	if err := Assert(context.Background(), newClient(bothCRDs(apiv1.AgentSchemaGeneration)...)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestAssertPassesOnNewerClusterSchema(t *testing.T) {
	if err := Assert(context.Background(), newClient(bothCRDs(apiv1.AgentSchemaGeneration+5)...)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestAssertFailsOnStaleSchema(t *testing.T) {
	err := Assert(context.Background(), newClient(bothCRDs(0)...))
	if err == nil || !strings.Contains(err.Error(), "operator CRD upgrade") {
		t.Fatalf("expected stale-schema error, got: %v", err)
	}
}

func TestAssertTreatsMissingAnnotationAsStale(t *testing.T) {
	objs := []runtime.Object{
		crd("agents."+apiv1.GroupVersion.Group, nil),
		crd("forks."+apiv1.GroupVersion.Group, nil),
	}
	err := Assert(context.Background(), newClient(objs...))
	if err == nil || !strings.Contains(err.Error(), "schema generation 0") {
		t.Fatalf("expected generation-0 error, got: %v", err)
	}
}

func TestAssertFailsOnMissingCRD(t *testing.T) {
	err := Assert(context.Background(), newClient())
	if err == nil || !strings.Contains(err.Error(), "not installed") {
		t.Fatalf("expected not-installed error, got: %v", err)
	}
}
