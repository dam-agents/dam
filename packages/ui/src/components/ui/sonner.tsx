import { useEffect } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { onToastHostMounted } from "@/lib/toast";
import { isDarkTheme } from "@/modules/platform/store/theme";
import { useStore } from "@/store";

const Toaster = (props: ToasterProps) => {
  const theme = useStore((s) => s.theme);

  useEffect(onToastHostMounted, []);
  const resolved = isDarkTheme(theme) ? "dark" : "light";
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
