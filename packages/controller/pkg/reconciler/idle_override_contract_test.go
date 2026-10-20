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

// TEST_SCENARIO: The idle override is a Go duration the controller resolves in seconds and the api-server projects to minutes for the UI and the usage report, in another language. Both sides read one fixture, so a form the controller accepts and the api-server drops fails here instead of reading as never-hibernate: a nonpositive duration is never, and a positive window under a minute is a minute, not none.
func TestTheIdleOverrideAgreesWithTheProjectionTheAPIServerMakes(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "contract", "idle-override.json"))
	require.NoError(t, err)
	var contract struct {
		Cases []struct {
			Duration string `json:"duration"`
			Minutes  int64  `json:"minutes"`
		} `json:"cases"`
	}
	require.NoError(t, json.Unmarshal(raw, &contract))
	require.NotEmpty(t, contract.Cases)
	base := config.AgentBase{IdleTimeout: config.Duration(time.Hour), VMIdleTimeout: config.Duration(5 * time.Minute)}

	for _, c := range contract.Cases {
		d, err := time.ParseDuration(c.Duration)
		require.NoError(t, err, "%q is not a Go duration", c.Duration)
		effective := effectiveIdleTimeout(&metav1.Duration{Duration: d}, true, base)
		assert.Equal(t, c.Minutes <= 0, effective <= 0, "%q: the controller and the projection must agree on whether it ever hibernates", c.Duration)
	}
}
