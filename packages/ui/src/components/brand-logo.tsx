import type { SVGProps } from "react";

export function DamSquareLogoDark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 270 270"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="DAM"
      {...props}
    >
      <defs>
        <linearGradient id="dam-dark-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f5d5d5" />
          <stop offset="100%" stopColor="#c9d5f0" />
        </linearGradient>
      </defs>
      <rect width="270" height="270" fill="url(#dam-dark-bg)" />
      <path
        d="M162.314 162.226V107H174.103L188.265 133.98H188.582L202.586 107H213.9V162.226H204.01V122.587H203.694L199.421 131.369L188.107 152.257L176.793 131.369L172.52 122.587H172.204V162.226H162.314Z"
        fill="black"
      />
      <path
        d="M154.171 162.226H143.332L138.901 148.143H119.279L114.928 162.226H104.326L122.84 107H135.816L154.171 162.226ZM136.369 139.202L129.249 116.494H128.853L121.811 139.202H136.369Z"
        fill="black"
      />
      <path
        d="M57 162.226V107H77.0966C91.4966 107 100.912 116.257 100.912 134.613C100.912 152.969 91.4966 162.226 77.0966 162.226H57ZM67.4439 152.969H77.0966C84.8504 152.969 89.835 148.38 89.835 138.965V130.261C89.835 120.846 84.8504 116.257 77.0966 116.257H67.4439V152.969Z"
        fill="black"
      />
    </svg>
  );
}

export function DamSquareLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 270 270"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="DAM"
      {...props}
    >
      <rect width="270" height="270" fill="black" />
      <path
        d="M162.314 162.226V107H174.103L188.265 133.98H188.582L202.586 107H213.9V162.226H204.01V122.587H203.694L199.421 131.369L188.107 152.257L176.793 131.369L172.52 122.587H172.204V162.226H162.314Z"
        fill="white"
      />
      <path
        d="M154.171 162.226H143.332L138.901 148.143H119.279L114.928 162.226H104.326L122.84 107H135.816L154.171 162.226ZM136.369 139.202L129.249 116.494H128.853L121.811 139.202H136.369Z"
        fill="white"
      />
      <path
        d="M57 162.226V107H77.0966C91.4966 107 100.912 116.257 100.912 134.613C100.912 152.969 91.4966 162.226 77.0966 162.226H57ZM67.4439 152.969H77.0966C84.8504 152.969 89.835 148.38 89.835 138.965V130.261C89.835 120.846 84.8504 116.257 77.0966 116.257H67.4439V152.969Z"
        fill="white"
      />
    </svg>
  );
}
