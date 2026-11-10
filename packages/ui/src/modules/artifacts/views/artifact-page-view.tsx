import { ArtifactPanel } from "../components/artifact-panel.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: One artifact alone in a browser tab, at
 * `/artifacts/<id>`, which the panel's Open in new tab opens. It is the app's
 * own page, signed in as the owner, so it opens a private artifact too, which
 * has no share link. It has no chat, so an interactive page asks its Agent in
 * a Session of its own, as on the Artifacts page. Another artifact's route
 * mounts a fresh panel, so a pinned version, the source view, an open dialog
 * or an edit draft never carries over to it.
 */
export function ArtifactPageView({ artifactId }: { artifactId: string }) {
  return (
    <main id="main" className="app-frame flex flex-col bg-background">
      <ArtifactPanel
        key={artifactId}
        artifactId={artifactId}
        agentId={null}
        standalone
      />
    </main>
  );
}
