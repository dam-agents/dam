package vmrunner

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
)

const (
	// UNIT_BOUNDARY_DESCRIPTION: the file smolvm points a machine's virtual console at, in the directory it keeps for that machine. The runtime writes it from the host side, so the runner reads it without touching the guest's disk — which is the guest's own filesystem, and parsing one the guest has had root on is not something the host should do.
	consoleLogName = "agent-console.log"
	// UNIT_BOUNDARY_DESCRIPTION: how much of the console a status carries. The status becomes the Agent's condition message, which the API server rejects over 32 KiB, and the message already holds the error that came before the console; a few kilobytes is the last screen of a boot, which is where a boot that failed stops.
	consoleTailBytes = 4096
	// UNIT_BOUNDARY_DESCRIPTION: how long after a start a guest that has not answered its health check is worth explaining. A cold boot that expands the runtime's disk templates takes about twenty-five seconds, so a guest silent for longer than this is stuck rather than slow. The same window paces how often the tail is read again, so a stuck machine rewrites its Agent's condition about once a minute and not on every poll.
	slowBootAfter = time.Minute
)

type slowBoot struct {
	message string
	at      time.Time
}

// UNIT_BOUNDARY_DESCRIPTION: the guest writes the console, so it is untrusted text on its way into a Kubernetes condition. Terminal escapes and other control characters are dropped and invalid UTF-8 replaced, so what an operator reads is text and not whatever the guest chose to print.
var terminalEscape = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)

func (r *Smolvm) ConsoleTail(id string) string {
	dir := r.vmDir(id)
	if dir == "" {
		return ""
	}
	return tailOf(filepath.Join(dir, consoleLogName), consoleTailBytes)
}

// UNIT_BOUNDARY_DESCRIPTION: the console is on the runner's claim and outlives the runner, while the values that redact it are what this process was given — a restarted runner knows only the applied spec, and an earlier boot may have printed a value that spec no longer holds. So each start begins an empty console: what a tail can show is then only the boot this runner started, with a spec it holds. The VMM is gone by the time this runs, so no writer holds the file open. A console that cannot be emptied is removed, and one that cannot be removed either is reported, because its old lines would reach a status unredacted. smolvm's agent logs every connection it accepts, and the runner opens one per health probe, so within a minute those lines are all the tail would hold; they say nothing about the guest and are dropped, from a window sixteen times the limit, so the guest's own last lines stay in view.
func clearConsole(id, dir string) {
	path := filepath.Join(dir, consoleLogName)
	err := os.Truncate(path, 0)
	if err == nil || errors.Is(err, fs.ErrNotExist) {
		return
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		slog.Warn("could not clear the machine console before its start", "machine", id, "error", err)
	}
}

func tailOf(path string, limit int64) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return ""
	}
	window := limit * 16
	offset := info.Size() - window
	if offset < 0 {
		offset = 0
	}
	body, err := io.ReadAll(io.NewSectionReader(f, offset, window))
	if err != nil {
		return ""
	}
	text := string(body)
	if offset > 0 {
		if cut := strings.IndexByte(text, '\n'); cut >= 0 {
			text = text[cut+1:]
		}
	}
	kept := make([]string, 0)
	for _, line := range strings.Split(strings.TrimSuffix(text, "\n"), "\n") {
		if strings.Contains(line, `"target":"smolvm_agent"`) && strings.Contains(line, `"message":"accepted connection"`) {
			continue
		}
		kept = append(kept, line)
	}
	text = strings.Join(kept, "\n")
	for int64(len(text)) > limit {
		cut := strings.IndexByte(text, '\n')
		if cut < 0 || int64(cut) >= limit {
			text = text[int64(len(text))-limit:]
			break
		}
		text = text[cut+1:]
	}
	return printable(text)
}

func printable(text string) string {
	text = terminalEscape.ReplaceAllString(strings.ToValidUTF8(text, "\uFFFD"), "")
	text = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' || !unicode.IsControl(r) {
			return r
		}
		return -1
	}, text)
	return strings.TrimSpace(text)
}

// UNIT_BOUNDARY_DESCRIPTION: an operator's Secret reaches the guest in its environment, and a guest that prints its environment puts those values on the console — so the tail is redacted with every value this runner has been given for the machine, the way a failed smolvm call's output is. Every start empties the console, so it only ever holds a boot this process started; values a machine no longer has are kept anyway, because a spec can change while that boot is still in the file. A tail this runner cannot redact, because it holds no spec for the machine at all, is not shown.
func (s *Server) rememberSecrets(id string, spec MachineSpec) {
	s.mu.Lock()
	defer s.mu.Unlock()
	known := s.secrets[id]
	if known == nil {
		known = []string{}
	}
	for _, v := range envValues(spec.Env) {
		if !slices.Contains(known, v) {
			known = append(known, v)
		}
	}
	s.secrets[id] = known
}

func (s *Server) consoleTail(id string) string {
	if s.Runtime == nil {
		return ""
	}
	s.mu.Lock()
	secrets, known := s.secrets[id]
	secrets = append([]string(nil), secrets...)
	s.mu.Unlock()
	if applied := s.readSpec(id); applied != nil {
		known = true
		secrets = append(secrets, envValues(applied.Env)...)
	}
	if !known {
		return ""
	}
	return redact(s.Runtime.ConsoleTail(id), secrets)
}

func withConsole(message, tail string) string {
	if tail == "" {
		return message
	}
	return message + "\nthe guest console ends:\n" + tail
}

// UNIT_BOUNDARY_DESCRIPTION: a guest that boots and never answers has no failure to report — its start call returned — so without this the Agent reads "not ready" for as long as it stays stuck, and why is only on the console. The note is kept rather than rebuilt on every status, because the controller polls a starting machine twice a second and a message that changed each time would be a status write each time. A recorded failure carries its own tail and wins; a new start or an answer clears the note. An answer also drops the start stamp: from then on the machine is up, and a probe it misses later is a health blip, not a boot still waited on, so neither the note nor `startingMs` comes back for it.
func (s *Server) watchBoot(id string, st *MachineStatus, startedAt time.Time, noFailure bool) {
	s.mu.Lock()
	op, awaiting := s.awaiting[id]
	started := s.startedAt[id]
	if st.Ready {
		delete(s.awaiting, id)
		delete(s.slowBoots, id)
		delete(s.startedAt, id)
	}
	note, noted := s.slowBoots[id]
	s.mu.Unlock()
	if st.Ready {
		if awaiting {
			s.metrics.becameReady(op, time.Since(started))
		}
		return
	}
	if !noFailure || startedAt.IsZero() || time.Since(startedAt) < slowBootAfter {
		return
	}
	if !noted || time.Since(note.at) >= slowBootAfter {
		note = slowBoot{
			message: withConsole(fmt.Sprintf("the guest is not answering its health check, and it was last asked to start more than %s ago", slowBootAfter), s.consoleTail(id)),
			at:      time.Now(),
		}
		s.mu.Lock()
		if s.startedAt[id].Equal(startedAt) {
			s.slowBoots[id] = note
		}
		s.mu.Unlock()
	}
	if st.Message == "" {
		st.Message = note.message
	} else {
		st.Message += "; " + note.message
	}
}
