import { useEffect } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { onToastHostMounted } from "@/lib/toast";
import { useStore } from "@/store";

const Toaster = (props: ToasterProps) => {
  const theme = useStore((s) => s.theme);

  // Runs after Sonner's own subscribe effect — child effects fire before the
  // parent's — so buffered toasts have somewhere to land by the time we flush.
  useEffect(onToastHostMounted, []);
  const resolved =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
      ? "dark"
      : "light";
  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "group toast group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
