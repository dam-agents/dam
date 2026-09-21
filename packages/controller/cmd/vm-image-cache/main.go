package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"k8s.io/apimachinery/pkg/api/resource"

	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

func main() {
	imageDir := flag.String("image-dir", "/var/lib/platform/images", "the node directory this service owns: unpacked agent images, shared with every VM runner scheduled here")
	cacheID := flag.String("cache-id", "", "this service's name among the processes sharing the image directory; required, because it is the name its claims are published under and an unnamed claim pins nothing")
	budget := flag.String("image-budget", "", "what the cached images may occupy, as a quantity (50Gi); required and positive, because below one byte nothing is evicted at all")
	crane := flag.String("crane", "crane", "crane binary, used to fetch an image and read what it says to run")
	images := flag.String("images", "", "comma-separated image references to fetch and keep: the harness images this install ships, which are the ones known before any agent asks for one")
	every := flag.Duration("interval", 5*time.Minute, "how often the claims are refreshed, a failed fetch retried and the directory swept")
	flag.Parse()

	if *cacheID == "" {
		slog.Error("--cache-id is required: it names this service's claims, and images claimed by nobody are the first thing eviction takes")
		os.Exit(1)
	}
	size, err := resource.ParseQuantity(*budget)
	if err != nil || size.Value() <= 0 {
		slog.Error("--image-budget must be a positive quantity: the node's filesystem is shared with everything else the node runs, so the cache is bounded by a stated number or not at all", "budget", *budget, "error", err)
		os.Exit(1)
	}
	if *every <= 0 || *every >= 15*time.Minute {
		slog.Error("--interval must be positive and well inside the window a runner believes a claim for, or the images this service pins stop being pinned between two of its own passes", "interval", every.String())
		os.Exit(1)
	}
	if err := os.MkdirAll(*imageDir, 0o755); err != nil {
		slog.Error("creating the image directory", "path", *imageDir, "error", err)
		os.Exit(1)
	}
	if err := os.Chmod(*imageDir, 0o755); err != nil {
		slog.Error("opening the image directory to the machine uids that read it", "path", *imageDir, "error", err)
		os.Exit(1)
	}

	var refs []string
	for _, ref := range strings.Split(*images, ",") {
		if ref = strings.TrimSpace(ref); ref != "" {
			refs = append(refs, ref)
		}
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	slog.Info("VM image cache serving", "imageDir", *imageDir, "images", len(refs), "interval", every.String())
	(&vmrunner.Preloader{
		ImageDir: *imageDir, Images: refs, ID: *cacheID, Budget: size.Value(), Crane: *crane, Every: *every,
	}).Run(ctx)
}
