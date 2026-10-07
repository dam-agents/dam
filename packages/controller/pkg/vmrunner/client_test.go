// TEST_OVERVIEW: the controller's client of the machine API. The runner re-reads its token file, so after the token Secret changes the two sides can disagree for a moment: a refused call must read the token again once and retry, and a refusal that stands must be told apart from every other failure. A runner that cannot be reached at all must be reported in words an owner may read, without the in-cluster host the dial error names.
package vmrunner

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func tokenServer(t *testing.T, want *atomic.Value) (*httptest.Server, *atomic.Int32) {
	calls := &atomic.Int32{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer "+want.Load().(string) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"state":"running","ready":true}`))
	}))
	t.Cleanup(srv.Close)
	return srv, calls
}

// TEST_SCENARIO: the runner already took a new token and the client still holds the old one. The first call is refused, the client reads the Secret again, and the retry carries the new token and succeeds.
func TestARefusedCallRetriesOnceWithTheTokenReadAgain(t *testing.T) {
	want := &atomic.Value{}
	want.Store("new")
	srv, calls := tokenServer(t, want)
	c, err := NewClient(srv.URL, "old", "")
	require.NoError(t, err)
	reads := 0
	c.WithTokenReload(func(context.Context) (string, error) {
		reads++
		return "new", nil
	})

	st, err := c.Ensure(context.Background(), "m1", MachineSpec{Running: true})

	require.NoError(t, err)
	assert.True(t, st.Ready)
	assert.Equal(t, 1, reads)
	assert.Equal(t, int32(2), calls.Load())
}

// TEST_SCENARIO: the Secret holds the very token the runner refused, or reading it fails. Retrying would be refused the same way, so the call fails at once with ErrUnauthorized, which callers can tell from an unreachable runner.
func TestARefusalThatStandsIsErrUnauthorized(t *testing.T) {
	want := &atomic.Value{}
	want.Store("runner-only")
	srv, calls := tokenServer(t, want)
	c, err := NewClient(srv.URL, "held", "")
	require.NoError(t, err)
	c.WithTokenReload(func(context.Context) (string, error) { return "held", nil })

	_, err = c.Status(context.Background(), "m1")
	assert.ErrorIs(t, err, ErrUnauthorized)
	assert.Equal(t, int32(1), calls.Load(), "an unchanged token is not sent again")

	c.WithTokenReload(func(context.Context) (string, error) { return "", errors.New("secret gone") })
	_, err = c.List(context.Background())
	assert.ErrorIs(t, err, ErrUnauthorized)
}

// TEST_SCENARIO: a runner whose address nothing listens on. The error that reaches the Agent's status names what happened and not the host or port the controller dialled; the dial error itself stays reachable for the log.
func TestAnUnreachableRunnerIsDescribedWithoutItsAddress(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	addr := srv.URL
	srv.Close()
	c, err := NewClient(addr, "t", "")
	require.NoError(t, err)

	_, err = c.Ensure(context.Background(), "m1", MachineSpec{})

	require.Error(t, err)
	var unreachable *UnreachableError
	require.ErrorAs(t, err, &unreachable)
	assert.Contains(t, err.Error(), "could not be reached")
	assert.False(t, strings.Contains(err.Error(), strings.TrimPrefix(addr, "http://")), "the dialled address leaked: %s", err)
	assert.NotNil(t, errors.Unwrap(unreachable))
}
