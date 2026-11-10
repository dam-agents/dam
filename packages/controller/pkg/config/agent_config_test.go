package config

import (
	"encoding/json"
	"maps"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
)

func TestAgentBase_JSONRoundTrip(t *testing.T) {
	in := AgentBase{
		ImagePullSecrets: []string{"regcred"},
		VMIdleTimeout:    Duration(3600 * 1_000_000_000),
	}
	data, err := json.Marshal(in)
	require.NoError(t, err)

	var out AgentBase
	require.NoError(t, json.Unmarshal(data, &out))
	assert.Equal(t, in.ImagePullSecrets, out.ImagePullSecrets)
	assert.Equal(t, "1h0m0s", out.VMIdleTimeout.AsDuration().String())
}

func TestHarnessTemplateDefaults_JSONRoundTrip(t *testing.T) {
	in := HarnessTemplateDefaults{
		StorageSize: "10Gi",
		Mounts: []Mount{
			{Path: "$HOME", Persist: true},
			{Path: "/tmp", Persist: false},
		},
		Env: []EnvVar{
			{Name: "PORT", Value: "8080"},
		},
	}
	data, err := json.Marshal(in)
	require.NoError(t, err)

	var out HarnessTemplateDefaults
	require.NoError(t, json.Unmarshal(data, &out))
	assert.Equal(t, "10Gi", out.StorageSize)
	require.Len(t, out.Mounts, 2)
	assert.Equal(t, "$HOME", out.Mounts[0].Path)
	assert.True(t, out.Mounts[0].Persist)
	require.Len(t, out.Env, 1)
	assert.Equal(t, "PORT", out.Env[0].Name)
}

// TEST_SCENARIO: the chart refuses a key this package's strict decoder would refuse at startup, and it refuses it from a key list of its own. A struct field added or removed — here or in a Kubernetes type the config embeds, such as `resources`, `tolerations` or `affinity` — without that list would let such a key render again and crash-loop the controller, and so would a value of the wrong kind, which the decoder refuses too. The two are held equal, nesting included: a struct is an `object` of its fields, a list an `array` of items, a map a `map` of free-form keys, a scalar its own kind, and a type that reads its own JSON the kind that decoder takes — `jsonKindOfTypes` where that is narrower than any value, `any` otherwise.
func TestChartControllerConfigKeys(t *testing.T) {
	chartJSON, err := os.ReadFile("../../../../helm/controller-config-keys.json")
	require.NoError(t, err)
	var chart map[string]any
	require.NoError(t, json.Unmarshal(chartJSON, &chart))

	structs := map[string]any{
		"AGENT_BASE":                      configKeys(reflect.TypeOf(AgentBase{})),
		"AGENT_HARNESS_TEMPLATE_DEFAULTS": configKeys(reflect.TypeOf(HarnessTemplateDefaults{})),
		"AGENT_VM":                        configKeys(reflect.TypeOf(VMConfig{})),
		"GATEWAY_EGRESS":                  configKeys(reflect.TypeOf(GatewayEgress{})),
	}
	if !reflect.DeepEqual(structs, chart) {
		want, err := json.MarshalIndent(structs, "", "  ")
		require.NoError(t, err)
		t.Fatalf("helm/controller-config-keys.json no longer mirrors these structs; it should read:\n%s", want)
	}
}

var jsonKindOfTypes = map[reflect.Type]string{
	reflect.TypeOf(Duration(0)):          "string",
	reflect.TypeOf(resource.Quantity{}):  "string|number",
	reflect.TypeOf(metav1.Duration{}):    "string",
	reflect.TypeOf(metav1.Time{}):        "string",
	reflect.TypeOf(intstr.IntOrString{}): "string|number",
}

func configKeys(t reflect.Type) any {
	if t.Kind() == reflect.Pointer {
		return configKeys(t.Elem())
	}
	if reflect.PointerTo(t).Implements(reflect.TypeOf((*json.Unmarshaler)(nil)).Elem()) {
		if kind, ok := jsonKindOfTypes[t]; ok {
			return kind
		}
		return "any"
	}
	switch t.Kind() {
	case reflect.Slice, reflect.Array:
		return map[string]any{"kind": "array", "items": configKeys(t.Elem())}
	case reflect.Map:
		return map[string]any{"kind": "map", "values": configKeys(t.Elem())}
	case reflect.Struct:
		fields := map[string]any{}
		for i := range t.NumField() {
			field := t.Field(i)
			name, _, _ := strings.Cut(field.Tag.Get("json"), ",")
			if name == "-" || !field.IsExported() {
				continue
			}
			if name == "" && field.Anonymous {
				if inner, ok := configKeys(field.Type).(map[string]any); ok {
					maps.Copy(fields, inner["fields"].(map[string]any))
				}
				continue
			}
			if name == "" {
				name = field.Name
			}
			fields[name] = configKeys(field.Type)
		}
		return map[string]any{"kind": "object", "fields": fields}
	case reflect.String:
		return "string"
	case reflect.Bool:
		return "boolean"
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
		reflect.Float32, reflect.Float64:
		return "number"
	default:
		return "any"
	}
}
