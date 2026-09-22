// UNIT_BOUNDARY_DESCRIPTION: the probe guest as an image entrypoint, so the machine API conformance suite can boot it on a real runner. It listens on the guest agent port every machine publishes, and keeps its marker in the agent's home, which is the one guest path a machine keeps across a stop.
package main

import (
	"log"
	"os"

	"github.com/dam-agents/dam/packages/controller/pkg/vmprobe"
)

func main() {
	log.Fatal(vmprobe.Serve(":8080", vmprobe.FromEnv(os.Getenv)))
}
