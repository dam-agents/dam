// TEST_OVERVIEW: the network policy of a runner admits its callers across namespaces, admits only the collector to the scrape port, and keeps working when the release name differs from the chart fullname.
package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TEST_SCENARIO: the runner now sits in the agent namespace while the api-server and controller stay in the release namespace, so its ingress peers have to name that namespace — a bare pod selector matches only the policy's own namespace, which would admit nobody and strand every vm agent. The one peer that does sit in the agent namespace is the owner's own runtime-migration Job.
func TestRunnerPolicyAdmitsItsCallersAcrossNamespaces(t *testing.T) {
	np := buildRunnerNetworkPolicy(testOwner, "platform", "platform", "test-agents", "release-ns", testConfig.EnvoyPort)

	require.Len(t, np.Spec.Ingress, 3, "the machine API and published ports, the migration Job's machine API, and the scrape port")
	for _, rule := range np.Spec.Ingress {
		require.NotEmpty(t, rule.From)
		for _, from := range rule.From {
			if from.PodSelector.MatchLabels[LabelRole] == RoleRuntimeMigration {
				continue
			}
			require.NotNil(t, from.NamespaceSelector, "a bare pod selector would only match the runner's own namespace")
			assert.Equal(t, "release-ns", from.NamespaceSelector.MatchLabels["kubernetes.io/metadata.name"])
		}
	}
}

// TEST_SCENARIO: the scrape port carries no token, so the NetworkPolicy is its only gate — it must admit the platform's collector to that port alone, and nothing else may reach it, while the collector reaches nothing but it.
func TestRunnerPolicyAdmitsOnlyTheCollectorToTheScrapePort(t *testing.T) {
	np := buildRunnerNetworkPolicy(testOwner, "platform", "platform", "test-agents", "release-ns", testConfig.EnvoyPort)

	var scrapers []string
	for _, rule := range np.Spec.Ingress {
		reachesScrape := false
		for _, port := range rule.Ports {
			if port.Port.IntValue() == vmRunnerMetricsPort {
				reachesScrape = true
			}
		}
		for _, from := range rule.From {
			component := from.PodSelector.MatchLabels["app.kubernetes.io/component"]
			if component == vmRunnerMetricsScraper {
				require.Len(t, rule.Ports, 1, "the collector reaches the scrape port and nothing else")
			}
			if reachesScrape {
				scrapers = append(scrapers, component)
			}
		}
	}
	assert.Equal(t, []string{vmRunnerMetricsScraper}, scrapers)
}

// TEST_SCENARIO: the release is not called `platform`, so the chart's fullname and the Helm release name diverge; the runner's ingress policy must still select the api-server and controller pods, which carry the release name — selecting on the fullname would admit nobody and strand every vm agent.
func TestRunnerPolicyAdmitsPeersWhenTheReleaseNameDiffersFromTheFullname(t *testing.T) {
	np := buildRunnerNetworkPolicy(testOwner, "dam-platform", "dam", "test-agents", "default", testConfig.EnvoyPort)

	var instances []string
	for _, rule := range np.Spec.Ingress {
		for _, from := range rule.From {
			if from.PodSelector.MatchLabels[LabelRole] == RoleRuntimeMigration {
				continue
			}
			instances = append(instances, from.PodSelector.MatchLabels["app.kubernetes.io/instance"])
		}
	}
	require.Len(t, instances, 3, "the api-server, the controller and the collector, and nothing else")
	for _, got := range instances {
		assert.Equal(t, "dam", got, "peers are selected by the release name the chart puts on its pods")
	}
	assert.Equal(t, "dam-platform-vm-runner-"+runnerSuffix(testOwner)+"-ingress", np.Name)
}
