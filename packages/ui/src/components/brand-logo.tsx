import type { SVGProps } from "react";

import { cn } from "@/lib/utils";

import { getBrand } from "../brand.js";

export function BrandLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label={getBrand().name}
      className={cn("h-[32px] w-[32px] text-foreground", className)}
      {...props}
    >
      <path
        d="M19.9724 20.3738V11.9978H21.7604L23.9084 16.0898H23.9564L26.0804 11.9978H27.7964V20.3738H26.2964V14.3618H26.2484L25.6004 15.6938L23.8844 18.8618L22.1684 15.6938L21.5204 14.3618H21.4724V20.3738H19.9724Z"
        fill="currentColor"
      />
      <path
        d="M18.738 20.3738H17.094L16.422 18.2378H13.446L12.786 20.3738H11.178L13.986 11.9978H15.954L18.738 20.3738ZM16.038 16.8818L14.958 13.4378H14.898L13.83 16.8818H16.038Z"
        fill="currentColor"
      />
      <path
        d="M3.99976 20.3738V11.9978H7.04776C9.23176 11.9978 10.6598 13.4018 10.6598 16.1858C10.6598 18.9698 9.23176 20.3738 7.04776 20.3738H3.99976ZM5.58376 18.9698H7.04776C8.22376 18.9698 8.97976 18.2738 8.97976 16.8458V15.5258C8.97976 14.0978 8.22376 13.4018 7.04776 13.4018H5.58376V18.9698Z"
        fill="currentColor"
      />
    </svg>
  );
}
