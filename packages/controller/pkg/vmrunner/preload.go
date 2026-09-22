package vmrunner

import (
	"context"
	"log/slog"
	"strings"
	"time"
)

// UNIT_BOUNDARY_DESCRIPTION: the images an install ships are known at deploy time; a runner is not, because it exists only once one of its owner's agents needs one. So the first machine on every image, on every node, after every deploy, pays for the fetch and the unpack with a user waiting on it. This is the part of the image cache that exists before any agent: one per node, it fetches what the install ships into the directory the node's runners share, and keeps it there. Keeping it is the harder half — eviction spares only images some machine is running, and an image preloaded for nobody is held by nobody and is the oldest write, so it would be the first thing deleted. It therefore claims those images the same way a runner claims its machines' images, in the same holders directory, for as long as the process lives.
// UNIT_BOUNDARY_DESCRIPTION: it drives the runner's own cache code rather than reimplementing it. The cache is a protocol between processes — how a reference becomes a directory name, which entries are complete, which are claimed, what order they are evicted in — and a second implementation of it that drifted from the first would delete a tree a running guest has mounted as its root filesystem. So this is a runner with no machines: what it claims is a list, and it never boots anything.
type Preloader struct {
	ImageDir string
	Images   []string
	ID       string
	Budget   int64
	Crane    string
	Every    time.Duration
	// UNIT_BOUNDARY_DESCRIPTION: the docker config to fetch with, built from the install's default pull Secrets. It is read again on every pass, so a rotated Secret is used without a restart. Nil or empty fetches anonymously.
	PullAuth func() string
}

func (p *Preloader) cache() *Server {
	return &Server{ImageDir: p.ImageDir, RunnerID: p.ID, Crane: p.Crane, ImageBudget: p.Budget, Pinned: p.Images}
}

// UNIT_BOUNDARY_DESCRIPTION: claims are published before anything is fetched, because a runner sharing this directory evicts on what it can read here and nothing else. They are published again after each fetch, because a claim is believed only while it is being refreshed and a pass is not quick: every image is allowed a whole pull timeout, so a pass over several of them can outlast the window a runner believes a claim for. Left to the gap between passes alone, this service's own claim would go stale while the very pass that wrote it was still running, and the images it had already preloaded would be evicted by the next runner to want the room. Refreshing between images bounds the gap by one fetch instead of by the whole pass. It sweeps on every pass rather than only after a fetch: the runners tidy the directory only as a side effect of paying for a miss, so on a node whose images are all cached nothing prunes what an owner who has gone left behind.
func (p *Preloader) Sweep() {
	cache := p.cache()
	cache.publishHolders()
	auth := ""
	if p.PullAuth != nil {
		auth = p.PullAuth()
	}
	for _, ref := range p.Images {
		if !imageRef.MatchString(ref) || strings.Contains(ref, "..") {
			slog.Warn("image cache: this install names an image the preloader will not fetch", "reason", "the reference is not one a cache entry can be named after")
			continue
		}
		cached := cache.cachePath(ref)
		if launch, _ := readLaunch(cached); launch != nil {
			continue
		}
		if err := cache.cacheImage(ref, cached, "", auth); err != nil {
			slog.Warn("image cache: preloading an image this install ships", "image", ref, "error", err)
		}
		cache.publishHolders()
	}
	cache.evictImages(p.ImageDir, "", p.Budget)
}

// UNIT_BOUNDARY_DESCRIPTION: a claim is believed while it is being refreshed, so the sweep is also this service's heartbeat — stop refreshing and the images it preloaded become evictable again, which is what should happen when it is gone. The interval bounds the gap between passes, not the lease: a pass refreshes as it goes, because it can run for longer than the window a runner believes a claim for. It is also how long a registry that was down is waited out.
func (p *Preloader) Run(ctx context.Context) {
	for {
		p.Sweep()
		select {
		case <-ctx.Done():
			return
		case <-time.After(p.Every):
		}
	}
}

// UNIT_BOUNDARY_DESCRIPTION: entries this process keeps although no machine of its own is running one, keyed the way eviction keys them. Both shapes are named, because an archive an earlier release cached still boots a machine and evicting it would cost the install the only copy it has.
func (s *Server) pinnedImages() map[string]bool {
	if len(s.Pinned) == 0 {
		return nil
	}
	held := map[string]bool{}
	for _, ref := range s.Pinned {
		if !imageRef.MatchString(ref) || strings.Contains(ref, "..") {
			continue
		}
		base := s.cachePath(ref)
		held[base], held[base+".tar"] = true, true
	}
	return held
}
