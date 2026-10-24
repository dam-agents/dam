package reconciler

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

// TEST_SCENARIO: The idle override is a Go duration the controller resolves against the chart default and the api-server projects to minutes for the UI and the usage report, in another language. Both sides read one fixture of real `time.ParseDuration` answers, so a form one accepts and the other drops fails here instead of reading as never-hibernate: a nonpositive duration is never, a positive window under a minute is a minute, and a duration Go refuses is refused on both sides.
func TestTheIdleOverrideAgreesWithTheProjectionTheAPIServerMakes(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "contract", "idle-override.json"))
	require.NoError(t, err)
	var contract struct {
		Cases []struct {
			Duration string `json:"duration"`
			Minutes  int64  `json:"minutes"`
		} `json:"cases"`
		Invalid []string `json:"invalid"`
	}
	require.NoError(t, json.Unmarshal(raw, &contract))
	require.NotEmpty(t, contract.Cases)
	require.NotEmpty(t, contract.Invalid)
	base := config.AgentBase{VMIdleTimeout: config.Duration(5 * time.Minute)}

	for _, c := range contract.Cases {
		d, err := time.ParseDuration(c.Duration)
		require.NoError(t, err, "%q is not a Go duration", c.Duration)
		effective := effectiveIdleTimeout(&metav1.Duration{Duration: d}, base)
		assert.Equal(t, c.Minutes <= 0, effective <= 0, "%q: the controller and the projection must agree on whether it ever hibernates", c.Duration)
	}
	for _, bad := range contract.Invalid {
		_, err := time.ParseDuration(bad)
		assert.Error(t, err, "%q must be a duration Go refuses", bad)
	}
}
