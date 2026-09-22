import {
  AVATAR_GAP,
  AVATAR_INK,
  AVATAR_SCLERA,
  AVATAR_STICK,
} from "./constants.js";
import { HEAD_GEOMETRY, type HeadGeometry } from "./geometry.js";
import {
  AVATAR_CENTER,
  AVATAR_VIEWBOX,
  bandEdges,
  type Box,
  bugEyeCenter,
  capCurve,
  capEdge,
  chinCurve,
  chinEdge,
  MOUTH_Y,
  placeEyes,
  visorBox,
  wingPath,
  winkLayout,
} from "./layout.js";
import { type AvatarTraits, avatarTraits, type Look } from "./traits.js";

type Attrs = Record<string, string | number>;

const SIDES = [-1, 1] as const;
const STICK = 4.5;
const CACHE_LIMIT = 512;

function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function el(tag: string, attrs: Attrs, children = ""): string {
  const list = Object.entries(attrs)
    .map(([k, v]) => `${k}="${typeof v === "number" ? num(v) : v}"`)
    .join(" ");
  const open = list ? `${tag} ${list}` : tag;
  return children ? `<${open}>${children}</${tag}>` : `<${open}/>`;
}

function rect(box: Box, fill: string): string {
  return el("rect", { ...box, fill });
}

function pupil(cx: number, cy: number, r: number, ratio: number, look: Look) {
  const size = r * ratio;
  const reach = r - size - Math.max(r * 0.16, 1.2);
  return el("circle", {
    cx: cx + look.dx * reach,
    cy: cy + look.dy * reach,
    r: size,
    fill: AVATAR_INK,
  });
}

function sides(t: AvatarTraits, head: HeadGeometry): string {
  const left = AVATAR_CENTER - head.halfWidth - AVATAR_GAP;
  const right = AVATAR_CENTER + head.halfWidth + AVATAR_GAP;
  const fill = t.colors.side;
  switch (t.sides) {
    case "none":
      return "";
    case "block":
      return [left - 8.5, right]
        .map((x) =>
          el("rect", { x, y: 39, width: 8.5, height: 22, rx: 4, fill }),
        )
        .join("");
    case "round":
      return (
        el("path", {
          d: `M${num(left)},40 A10,10 0 0 0 ${num(left)},60 Z`,
          fill,
        }) +
        el("path", {
          d: `M${num(right)},40 A10,10 0 0 1 ${num(right)},60 Z`,
          fill,
        })
      );
    case "wings":
      return SIDES.map((side) =>
        el("path", {
          d: wingPath(head, side),
          fill,
          stroke: fill,
          "stroke-width": 3,
          "stroke-linejoin": "round",
        }),
      ).join("");
  }
}

function top(t: AvatarTraits, head: HeadGeometry): string {
  const clear = head.top - AVATAR_GAP;
  const fill = t.colors.ornament;
  switch (t.top) {
    case "none":
    case "cap":
      return "";
    case "antenna":
      return (
        el("rect", {
          x: AVATAR_CENTER - STICK / 2,
          y: head.top - 13,
          width: STICK,
          height: 13 - AVATAR_GAP,
          rx: STICK / 2,
          fill,
        }) + el("circle", { cx: AVATAR_CENTER, cy: head.top - 14, r: 6, fill })
      );
    case "twin":
      return SIDES.map((side) => {
        const x = AVATAR_CENTER + side * 16;
        const y = head.top - 12;
        return (
          el("line", {
            x1: AVATAR_CENTER + side * 9,
            y1: clear - 2.5,
            x2: x,
            y2: y,
            stroke: AVATAR_STICK,
            "stroke-width": STICK,
            "stroke-linecap": "round",
          }) + el("circle", { cx: x, cy: y, r: 5.5, fill })
        );
      }).join("");
    case "bolt":
      return el("rect", {
        x: AVATAR_CENTER - 8,
        y: clear - 7,
        width: 16,
        height: 7,
        rx: 2.5,
        fill,
      });
    case "bug-eyes":
      return t.bugEyes
        .map((bug, i) => {
          const [cx, cy] = bugEyeCenter(head, i, bug.r);
          return el("circle", { cx, cy, r: bug.r, fill });
        })
        .join("");
  }
}

function bottom(t: AvatarTraits, head: HeadGeometry): string {
  const below = head.bottom + AVATAR_GAP;
  switch (t.bottom) {
    case "none":
      return "";
    case "neck":
      return el("rect", {
        x: AVATAR_CENTER - 11,
        y: below,
        width: 22,
        height: 7,
        rx: 3,
        fill: t.colors.neck ?? AVATAR_STICK,
      });
    case "stripes": {
      const wide = Math.min(21, head.halfWidth - 2);
      const narrow = wide - 5;
      return [
        [wide, below],
        [narrow, below + 5.5 + AVATAR_GAP],
      ]
        .map(([half, y]) =>
          el("rect", {
            x: AVATAR_CENTER - half!,
            y: y!,
            width: half! * 2,
            height: 5.5,
            rx: 2.75,
            fill: t.colors.bottom,
          }),
        )
        .join("");
    }
  }
}

function overlays(t: AvatarTraits, head: HeadGeometry): string {
  const parts: string[] = [];
  if (t.top === "cap") {
    const edge = capEdge(head);
    parts.push(
      el("path", {
        d: `M0,0 H100 V${num(edge)} Q${AVATAR_CENTER},${num(edge + 7)} 0,${num(edge)} Z`,
        fill: t.colors.cap,
      }),
    );
  }
  if (t.banding === "chin") {
    const edge = chinEdge(head);
    parts.push(
      el("path", {
        d: `M0,${num(edge)} Q${AVATAR_CENTER},${num(edge - 5)} 100,${num(edge)} V100 H0 Z`,
        fill: t.colors.chin,
      }),
    );
  }
  if (t.banding === "bands") {
    const [upper, lower] = bandEdges(head);
    parts.push(
      el("rect", {
        x: 0,
        y: upper,
        width: 100,
        height: lower - upper,
        fill: t.colors.band,
      }),
    );
  }
  return parts.join("");
}

function visor(t: AvatarTraits, head: HeadGeometry): string {
  const box = visorBox(t, head);
  const centerY = box.y + box.height / 2;
  const spread = box.width / 4;
  const dot = Math.min(5, box.height / 4);
  const glyphs = SIDES.map((side) => {
    const cx = AVATAR_CENTER + side * spread;
    return t.face === "happy"
      ? el("path", {
          d: `M${num(cx - dot)},${num(centerY + dot * 0.45)} a${num(dot)},${num(dot)} 0 0 1 ${num(dot * 2)},0`,
          fill: "none",
          stroke: t.colors.glow,
          "stroke-width": 4.2,
          "stroke-linecap": "round",
        })
      : el("circle", { cx, cy: centerY, r: dot, fill: t.colors.glow });
  }).join("");
  return rect(box, AVATAR_INK) + glyphs;
}

function face(t: AvatarTraits, head: HeadGeometry): string {
  switch (t.face) {
    case "blank":
      return "";
    case "eyes":
      return placeEyes(t, head)
        .map(
          (e) =>
            el("circle", { cx: e.x, cy: e.y, r: e.r, fill: AVATAR_SCLERA }) +
            pupil(e.x, e.y, e.r, e.pupil, e.look),
        )
        .join("");
    case "visor":
    case "happy":
      return visor(t, head);
    case "wink": {
      const wink = winkLayout(t, head);
      return (
        el("circle", { ...wink.dot, fill: AVATAR_INK }) +
        rect(wink.dash, AVATAR_INK)
      );
    }
  }
}

function mouth(t: AvatarTraits): string {
  const y = MOUTH_Y;
  switch (t.mouth) {
    case "none":
      return "";
    case "line":
      return el("rect", {
        x: AVATAR_CENTER - 8,
        y,
        width: 16,
        height: 5.5,
        rx: 2.75,
        fill: AVATAR_INK,
      });
    case "smile":
      return el("path", {
        d: `M${AVATAR_CENTER - 7},${y} Q${AVATAR_CENTER},${y + 7} ${AVATAR_CENTER + 7},${y}`,
        fill: "none",
        stroke: AVATAR_INK,
        "stroke-width": 4.5,
        "stroke-linecap": "round",
      });
    case "o":
      return el("circle", {
        cx: AVATAR_CENTER,
        cy: y + 2.5,
        r: 3.8,
        fill: AVATAR_INK,
      });
  }
}

function gapLines(t: AvatarTraits, head: HeadGeometry): string {
  const lines: string[] = [];
  if (t.top === "cap") lines.push(el("path", { d: capCurve(head) }));
  if (t.banding === "chin") lines.push(el("path", { d: chinCurve(head) }));
  if (t.banding === "bands")
    for (const y of bandEdges(head))
      lines.push(el("line", { x1: 0, y1: y, x2: 100, y2: y }));
  if (t.face === "visor" || t.face === "happy") {
    const box = visorBox(t, head);
    const half = AVATAR_GAP / 2;
    lines.push(
      el("rect", {
        x: box.x - half,
        y: box.y - half,
        width: box.width + AVATAR_GAP,
        height: box.height + AVATAR_GAP,
        rx: box.rx + half,
      }),
    );
  }
  return el(
    "g",
    {
      fill: "none",
      stroke: "black",
      "stroke-width": AVATAR_GAP,
      "clip-path": "url(#h)",
    },
    lines.join(""),
  );
}

export function avatarSvg(seed: string): string {
  const t = avatarTraits(seed);
  const head = HEAD_GEOMETRY[t.head];
  const defs =
    el("clipPath", { id: "h" }, el("path", { d: head.path })) +
    el(
      "mask",
      {
        id: "g",
        maskUnits: "userSpaceOnUse",
        x: -10,
        y: -10,
        width: 120,
        height: 120,
      },
      el("rect", { x: -10, y: -10, width: 120, height: 120, fill: "white" }) +
        gapLines(t, head),
    );
  const figure =
    top(t, head) +
    bottom(t, head) +
    sides(t, head) +
    el("path", { d: head.path, fill: t.colors.head }) +
    el(
      "g",
      { "clip-path": "url(#h)" },
      overlays(t, head) + face(t, head) + mouth(t),
    );
  return el(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", viewBox: AVATAR_VIEWBOX },
    el("defs", {}, defs) + el("g", { mask: "url(#g)" }, figure),
  );
}

const cache = new Map<string, string>();

export function avatarDataUri(seed: string): string {
  const hit = cache.get(seed);
  if (hit !== undefined) return hit;
  const uri = `data:image/svg+xml,${encodeURIComponent(avatarSvg(seed))}`;
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(seed, uri);
  return uri;
}
