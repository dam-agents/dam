import { lazy, Suspense } from "react";

import { MockStateBar, useCardGalleryOverride } from "./state-bar.js";

const CardGallery = lazy(() =>
  import("./data/agent-card-gallery.js").then((m) => ({
    default: m.AgentCardGallery,
  })),
);

export function MockAppWrapper({ children }: { children: React.ReactNode }) {
  const gallery = useCardGalleryOverride();

  return (
    <>
      <MockStateBar />
      {gallery.active ? (
        <div className="mx-auto w-full max-w-[960px] px-4 py-6 md:px-[5%] md:py-10">
          <Suspense fallback={null}>
            <CardGallery />
          </Suspense>
        </div>
      ) : (
        children
      )}
    </>
  );
}
