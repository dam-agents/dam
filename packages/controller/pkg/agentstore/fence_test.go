package agentstore

import "testing"

func TestRefusal(t *testing.T) {
	absorbedMarker := map[string]string{MarkerKey: ModePostgres, KeyAbsorbed: "2026-10-24T00:00:00Z"}

	cases := []struct {
		name   string
		mode   string
		marker map[string]string
		refuse bool
	}{
		{"the custom resources stay authoritative", ModeCRD, nil, false},
		{"a marked store strands a build on the custom resources", ModeCRD, map[string]string{MarkerKey: ModePostgres}, true},
		{"a marked and absorbed store strands it too", ModeCRD, absorbedMarker, true},
		{"a store configured as Postgres with nothing absorbed", ModePostgres, nil, true},
		{"a switch that left no absorb stamp", ModePostgres, map[string]string{MarkerKey: ModePostgres}, true},
		{"an absorbed store", ModePostgres, absorbedMarker, false},
		{"an unknown mode", "sqlite", nil, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Refusal(tc.mode, tc.marker)
			if tc.refuse && got == "" {
				t.Fatalf("Refusal(%q, %v) = \"\", want a refusal", tc.mode, tc.marker)
			}
			if !tc.refuse && got != "" {
				t.Fatalf("Refusal(%q, %v) = %q, want no refusal", tc.mode, tc.marker, got)
			}
		})
	}
}

func TestMarkerName(t *testing.T) {
	if got := MarkerName("platform"); got != "platform-agent-store" {
		t.Fatalf("MarkerName(platform) = %q, want platform-agent-store", got)
	}
}
