package scheduler

import (
	"testing"
	"time"

	"github.com/kagenti/platform/packages/controller/pkg/types"
)

func TestIsInQuietHours(t *testing.T) {
	loc := time.UTC
	at := func(h, m int) time.Time { return time.Date(2026, 4, 23, h, m, 0, 0, loc) }

	cases := []struct {
		name    string
		windows []types.QuietWindow
		t       time.Time
		want    bool
	}{
		{"no windows", nil, at(3, 0), false},
		{"disabled window ignored",
			[]types.QuietWindow{{StartTime: "22:00", EndTime: "06:00", Enabled: false}},
			at(3, 0), false},
		{"inside crosses-midnight window (late)",
			[]types.QuietWindow{{StartTime: "22:00", EndTime: "06:00", Enabled: true}},
			at(23, 30), true},
		{"inside crosses-midnight window (early)",
			[]types.QuietWindow{{StartTime: "22:00", EndTime: "06:00", Enabled: true}},
			at(3, 15), true},
		{"outside crosses-midnight window",
			[]types.QuietWindow{{StartTime: "22:00", EndTime: "06:00", Enabled: true}},
			at(12, 0), false},
		{"at endTime is excluded (half-open)",
			[]types.QuietWindow{{StartTime: "22:00", EndTime: "06:00", Enabled: true}},
			at(6, 0), false},
		{"at startTime is included",
			[]types.QuietWindow{{StartTime: "22:00", EndTime: "06:00", Enabled: true}},
			at(22, 0), true},
		{"simple daytime window - inside",
			[]types.QuietWindow{{StartTime: "12:00", EndTime: "13:00", Enabled: true}},
			at(12, 30), true},
		{"simple daytime window - outside",
			[]types.QuietWindow{{StartTime: "12:00", EndTime: "13:00", Enabled: true}},
			at(14, 0), false},
		{"any-of-multiple matches",
			[]types.QuietWindow{
				{StartTime: "22:00", EndTime: "06:00", Enabled: true},
				{StartTime: "12:00", EndTime: "13:00", Enabled: true},
			},
			at(12, 30), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isInQuietHours(tc.t, tc.windows); got != tc.want {
				t.Fatalf("isInQuietHours(%v, %v) = %v, want %v", tc.t, tc.windows, got, tc.want)
			}
		})
	}
}

func TestNextVisibleOccurrence_skipsQuietWindow(t *testing.T) {
	loc := time.UTC
	rule, err := types.ParseRRuleInLocation(
		"FREQ=HOURLY;BYMINUTE=0;BYSECOND=0",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	// Anchor so we control where occurrences land.
	rule.DTStart(time.Date(2026, 4, 23, 0, 0, 0, 0, loc))

	windows := []types.QuietWindow{
		{StartTime: "22:00", EndTime: "06:00", Enabled: true},
	}

	// Ask for occurrences after 21:30 — the next candidate is 22:00 (quiet).
	// It should walk forward to 06:00, which is also *not* in the window
	// (half-open), so 06:00 should be returned.
	after := time.Date(2026, 4, 23, 21, 30, 0, 0, loc)
	got := nextVisibleOccurrence(rule, windows, loc, after)
	want := time.Date(2026, 4, 24, 6, 0, 0, 0, loc)
	if !got.Equal(want) {
		t.Fatalf("nextVisibleOccurrence = %v, want %v", got, want)
	}
}
