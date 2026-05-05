package scheduler

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/teambition/rrule-go"

	"github.com/kagenti/platform/packages/controller/pkg/types"
)

// maxQuietHoursSkipIterations bounds the walk when every RRULE occurrence
// falls inside a quiet-hours window. 1440 = minutes in a day, i.e. one full
// day's worth of minute-frequency occurrences — if we've skipped that many
// in a row, the schedule is misconfigured (e.g. quiet 00:01–23:59 with
// FREQ=MINUTELY) and we give up rather than loop forever.
const maxQuietHoursSkipIterations = 1440

// isInQuietHours reports whether `t` (already in the schedule's timezone)
// falls inside any enabled QuietWindow. Windows where EndTime <= StartTime
// are treated as crossing midnight.
func isInQuietHours(t time.Time, windows []types.QuietWindow) bool {
	if len(windows) == 0 {
		return false
	}
	m := t.Hour()*60 + t.Minute()
	for _, w := range windows {
		if !w.Enabled {
			continue
		}
		start, startErr := parseHHMM(w.StartTime)
		end, endErr := parseHHMM(w.EndTime)
		if startErr != nil || endErr != nil {
			continue // validator should have caught this; skip defensively
		}
		if start == end {
			continue
		}
		if start < end {
			if m >= start && m < end {
				return true
			}
		} else {
			// Crosses midnight: [start, 24:00) ∪ [00:00, end).
			if m >= start || m < end {
				return true
			}
		}
	}
	return false
}

// nextVisibleOccurrence returns the first RRULE occurrence strictly after `after`
// that is not inside any enabled quiet-hours window. The returned time is in
// the schedule's timezone. Zero time means the rule is exhausted.
func nextVisibleOccurrence(
	rule *rrule.RRule,
	windows []types.QuietWindow,
	loc *time.Location,
	after time.Time,
) time.Time {
	cursor := after
	for i := 0; i < maxQuietHoursSkipIterations; i++ {
		next := rule.After(cursor, false)
		if next.IsZero() {
			return time.Time{}
		}
		localNext := next.In(loc)
		if !isInQuietHours(localNext, windows) {
			return localNext
		}
		cursor = next
	}
	return time.Time{}
}

func parseHHMM(s string) (int, error) {
	parts := strings.Split(s, ":")
	if len(parts) != 2 {
		return 0, fmt.Errorf("want HH:MM, got %q", s)
	}
	h, err := strconv.Atoi(parts[0])
	if err != nil || h < 0 || h > 23 {
		return 0, fmt.Errorf("bad hour in %q", s)
	}
	m, err := strconv.Atoi(parts[1])
	if err != nil || m < 0 || m > 59 {
		return 0, fmt.Errorf("bad minute in %q", s)
	}
	return h*60 + m, nil
}
