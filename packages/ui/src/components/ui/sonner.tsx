import {
  Checkmark,
  ErrorOutline,
  Information,
  Warning,
} from "@carbon/icons-react";
import { useEffect } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { onToastHostMounted } from "@/lib/toast";
import { useStore } from "@/store";

const Toaster = (props: ToasterProps) => {
  const theme = useStore((s) => s.theme);

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
      closeButton
      icons={{
        info: <Information size={16} />,
        warning: <Warning size={16} />,
        success: <Checkmark size={16} />,
        error: <ErrorOutline size={16} />,
      }}
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
