import { useStore } from "../../store.js";

const BLUE = "#0f62fe";
const BLACK = "#000000";

function GrainDefs() {
  return (
    <svg className="pointer-events-none absolute h-0 w-0 overflow-hidden" aria-hidden="true">
      <defs>
        <filter id="grain" colorInterpolationFilters="sRGB">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="2.5"
            numOctaves="5"
            seed="7"
            result="n"
          />
          <feColorMatrix type="saturate" values="0" in="n" />
        </filter>
      </defs>
    </svg>
  );
}

function OriginalBlockReference() {
  return (
    <svg viewBox="0 0 400 280" fill="none" className="mx-auto w-full max-w-[500px]">
      <rect
        x="60"
        y="60"
        width="150"
        height="190"
        rx="8"
        fill={BLACK}
        transform="rotate(-4 135 155)"
      />
      <rect
        x="170"
        y="30"
        width="150"
        height="190"
        rx="8"
        fill={BLUE}
        transform="rotate(3 245 125)"
      />

      <circle cx="195" cy="140" r="32" fill="white" />
      <circle cx="195" cy="140" r="10" fill={BLACK} />

      <rect x="300" y="210" width="44" height="44" rx="6" fill={BLACK} />
      <rect x="310" y="220" width="24" height="3" rx="1" fill="white" />
      <rect x="310" y="228" width="16" height="3" rx="1" fill="white" />

      <g filter="url(#grain)">
        <circle cx="80" cy="246" r="14" fill={BLUE} />
        <rect x="56" y="34" width="28" height="28" rx="4" fill={BLUE} />
      </g>
      <circle cx="360" cy="60" r="8" fill={BLACK} />
    </svg>
  );
}

function SwatchSolidBlue() {
  return (
    <svg viewBox="0 0 120 120" className="w-full">
      <rect width="120" height="120" rx="8" fill={BLUE} />
    </svg>
  );
}

function SwatchSolidBlack() {
  return (
    <svg viewBox="0 0 120 120" className="w-full">
      <rect width="120" height="120" rx="8" fill={BLACK} />
    </svg>
  );
}

function SwatchBlackOutline() {
  return (
    <svg viewBox="0 0 120 120" className="w-full">
      <path
        d="M12 4 C40 2, 80 5, 110 3 C116 3, 118 8, 117 14 C119 42, 116 80, 118 108 C118 114, 114 118, 108 117 C80 119, 40 116, 12 118 C6 118, 3 114, 3 108 C2 80, 4 40, 3 12 C3 6, 6 3, 12 4 Z"
        fill="none"
        stroke={BLACK}
        strokeWidth="2.5"
      />
    </svg>
  );
}

function SwatchGrain() {
  return (
    <svg viewBox="0 0 120 120" className="w-full">
      <rect
        width="120"
        height="120"
        rx="8"
        fill="white"
        filter="url(#grain)"
      />
    </svg>
  );
}

function SwatchWhite() {
  return (
    <svg viewBox="0 0 120 120" className="w-full">
      <rect
        width="120"
        height="120"
        rx="8"
        fill="white"
        stroke="#e5e5e5"
        strokeWidth="1"
      />
    </svg>
  );
}

function CompositionA() {
  return (
    <svg viewBox="0 0 400 280" fill="none" className="w-full">
      <path d="M58 42 C100 39, 160 44, 218 40 C224 40, 226 44, 225 50 C228 110, 224 190, 226 248 C226 254, 222 256, 216 255 C160 258, 100 254, 58 256 C52 256, 50 252, 50 246 C48 190, 52 110, 50 50 C50 44, 52 41, 58 42 Z" fill="none" stroke={BLACK} strokeWidth="2.5" transform="rotate(-3 135 145)" />
      <rect x="160" y="70" width="130" height="150" rx="8" fill={BLACK} transform="rotate(2 225 145)" />
      <rect x="172" y="86" width="50" height="5" rx="2" fill="white" />
      <rect x="172" y="98" width="36" height="5" rx="2" fill="white" opacity="0.5" />
      <circle cx="80" cy="220" r="50" fill="white" filter="url(#grain)" />
      <rect x="280" y="60" width="80" height="100" rx="6" fill={BLUE} transform="rotate(3 320 110)" />
      <circle cx="360" cy="50" r="5" fill={BLUE} />
      <circle cx="30" cy="40" r="3" fill={BLACK} />
      <circle cx="380" cy="260" r="4" fill="white" />
    </svg>
  );
}

function CompositionB() {
  return (
    <svg viewBox="0 0 400 280" fill="none" className="w-full">
      <path d="M200 30 C260 28, 310 60, 308 140 C312 200, 270 252, 200 250 C140 254, 88 210, 90 140 C88 70, 130 32, 200 30 Z" fill="none" stroke={BLACK} strokeWidth="2.5" />
      <rect x="140" y="80" width="120" height="120" rx="8" fill={BLACK} transform="rotate(-2 200 140)" />
      <rect x="154" y="100" width="50" height="5" rx="2" fill="white" />
      <rect x="154" y="112" width="36" height="5" rx="2" fill="white" opacity="0.5" />
      <ellipse cx="130" cy="220" rx="60" ry="40" fill="white" filter="url(#grain)" />
      <circle cx="200" cy="160" r="24" fill={BLUE} />
      <circle cx="340" cy="50" r="4" fill={BLACK} />
      <circle cx="60" cy="240" r="6" fill={BLUE} />
      <circle cx="350" cy="230" r="3" fill="white" />
    </svg>
  );
}

function CompositionC() {
  return (
    <svg viewBox="0 0 400 280" fill="none" className="w-full">
      <path d="M38 52 C120 49, 260 54, 368 50 C374 50, 376 54, 375 60 C378 110, 374 190, 376 238 C376 244, 372 246, 366 245 C260 248, 120 244, 38 246 C32 246, 30 242, 30 236 C28 190, 32 110, 30 60 C30 54, 32 51, 38 52 Z" fill="none" stroke={BLACK} strokeWidth="2.5" transform="rotate(-1 200 145)" />
      <rect x="50" y="70" width="120" height="150" rx="6" fill={BLACK} transform="rotate(-2 110 145)" />
      <rect x="64" y="90" width="50" height="5" rx="2" fill="white" />
      <rect x="64" y="102" width="36" height="5" rx="2" fill="white" opacity="0.5" />
      <rect x="200" y="60" width="130" height="170" rx="6" fill={BLUE} transform="rotate(2 265 145)" />
      <rect x="216" y="80" width="60" height="5" rx="2" fill="white" />
      <rect x="216" y="92" width="44" height="5" rx="2" fill="white" opacity="0.5" />
      <circle cx="340" cy="200" r="40" fill="white" filter="url(#grain)" />
      <circle cx="370" cy="50" r="5" fill={BLACK} />
      <circle cx="20" cy="30" r="4" fill={BLUE} />
      <circle cx="390" cy="270" r="3" fill="white" />
    </svg>
  );
}

function CompositionD() {
  return (
    <svg viewBox="0 0 400 280" fill="none" className="w-full">
      <path d="M50 32 C140 29, 260 35, 358 31 C364 31, 366 35, 365 42 C368 110, 364 190, 366 248 C366 254, 362 256, 356 255 C260 258, 140 254, 50 256 C44 256, 42 252, 42 246 C40 190, 44 110, 42 42 C42 36, 44 31, 50 32 Z" fill="none" stroke={BLACK} strokeWidth="2.5" transform="rotate(-1 200 140)" />
      <rect x="60" y="55" width="120" height="90" rx="6" fill={BLACK} />
      <rect x="72" y="70" width="50" height="5" rx="2" fill="white" />
      <rect x="72" y="82" width="36" height="5" rx="2" fill="white" opacity="0.6" />
      <rect x="200" y="55" width="140" height="90" rx="6" fill={BLUE} />
      <rect x="214" y="70" width="60" height="5" rx="2" fill="white" />
      <rect x="214" y="82" width="44" height="5" rx="2" fill="white" opacity="0.5" />
      <ellipse cx="160" cy="200" rx="90" ry="40" fill="white" filter="url(#grain)" />
      <rect x="270" y="170" width="70" height="60" rx="6" fill="white" />
      <rect x="282" y="184" width="40" height="4" rx="2" fill={BLACK} opacity="0.15" />
      <rect x="282" y="194" width="28" height="4" rx="2" fill={BLACK} opacity="0.1" />
      <circle cx="380" cy="20" r="4" fill={BLUE} />
      <circle cx="20" cy="260" r="3" fill={BLACK} />
    </svg>
  );
}

function IconExample() {
  return (
    <svg viewBox="0 0 400 120" fill="none" className="w-full">
      <rect x="21" y="21" width="78" height="78" rx="12" fill={BLACK} transform="rotate(-3 60 60)" />
      <rect x="34" y="44" width="48" height="5" rx="2" fill="white" />
      <rect x="34" y="56" width="32" height="5" rx="2" fill="white" opacity="0.5" />
      <circle cx="52" cy="78" r="8" fill={BLUE} />
      <circle cx="108" cy="24" r="3" fill={BLUE} />

      <path d="M151 27 C165 25, 185 29, 207 26 C212 26, 213 30, 212 35 C214 55, 212 75, 213 91 C213 96, 210 97, 205 96 C185 98, 165 95, 151 97 C146 97, 144 94, 144 89 C143 75, 145 55, 143 35 C143 30, 145 26, 151 27 Z" fill="none" stroke={BLACK} strokeWidth="2" />
      <circle cx="150" cy="30" r="24" fill="white" filter="url(#grain)" />
      <circle cx="175" cy="50" r="12" fill={BLUE} />
      <circle cx="200" cy="100" r="2" fill={BLACK} />

      <circle cx="280" cy="60" r="39" fill={BLACK} />
      <ellipse cx="264" cy="44" rx="20" ry="16" fill="white" filter="url(#grain)" />
      <circle cx="280" cy="60" r="14" fill={BLUE} />
      <circle cx="330" cy="26" r="3" fill="white" />

      <path d="M355 31 C362 30, 374 33, 383 30 C387 30, 388 33, 387 37 C389 55, 387 75, 388 93 C388 97, 386 98, 382 97 C374 99, 362 96, 355 98 C351 98, 349 96, 349 92 C348 75, 350 55, 349 37 C349 33, 350 30, 355 31 Z" fill="none" stroke={BLACK} strokeWidth="2" transform="rotate(2 366 62)" />
      <ellipse cx="366" cy="50" rx="14" ry="10" fill="white" filter="url(#grain)" />
      <rect x="354" y="72" width="20" height="4" rx="2" fill={BLACK} />
      <circle cx="390" cy="100" r="3" fill={BLUE} />
    </svg>
  );
}

function IllustrationEmptyState() {
  return (
    <svg viewBox="0 0 600 300" fill="none" className="mx-auto w-full max-w-[600px]">
      <path d="M131 33 C230 30, 370 36, 477 32 C483 32, 485 36, 484 42 C487 120, 483 210, 485 267 C485 273, 481 275, 475 274 C370 277, 230 273, 131 275 C125 275, 123 271, 123 265 C121 210, 125 120, 123 42 C123 36, 125 32, 131 33 Z" fill="none" stroke={BLACK} strokeWidth="2.5" transform="rotate(-2 300 150)" />
      <rect x="160" y="60" width="140" height="180" rx="8" fill={BLACK} transform="rotate(-1 230 150)" />
      <rect x="176" y="84" width="60" height="5" rx="2" fill="white" />
      <rect x="176" y="96" width="44" height="5" rx="2" fill="white" opacity="0.5" />
      <rect x="176" y="108" width="80" height="5" rx="2" fill="white" opacity="0.3" />
      <ellipse cx="100" cy="200" rx="70" ry="50" fill="white" filter="url(#grain)" />
      <rect x="340" y="80" width="100" height="140" rx="8" fill="white" />
      <rect x="356" y="104" width="60" height="5" rx="2" fill={BLACK} opacity="0.15" />
      <rect x="356" y="116" width="44" height="5" rx="2" fill={BLACK} opacity="0.1" />
      <circle cx="390" cy="180" r="18" fill={BLUE} />
      <rect x="382" y="176" width="16" height="3" rx="1" fill="white" />
      <rect x="388" y="170" width="4" height="15" rx="1" fill="white" />
      <circle cx="540" cy="50" r="5" fill={BLUE} />
      <circle cx="80" cy="50" r="4" fill={BLACK} />
      <circle cx="520" cy="270" r="3" fill="white" />
    </svg>
  );
}

function IllustrationConnected() {
  return (
    <svg viewBox="0 0 600 300" fill="none" className="mx-auto w-full max-w-[600px]">
      <path d="M61 63 C100 60, 150 66, 197 62 C203 62, 205 66, 204 72 C207 130, 203 200, 205 237 C205 243, 201 245, 195 244 C150 247, 100 243, 61 245 C55 245, 53 241, 53 235 C51 200, 55 130, 53 72 C53 66, 55 62, 61 63 Z" fill="none" stroke={BLACK} strokeWidth="2.5" transform="rotate(-3 125 150)" />
      <rect x="251" y="51" width="148" height="198" rx="10" fill={BLACK} transform="rotate(2 325 150)" />
      <rect x="267" y="76" width="60" height="5" rx="2" fill="white" />
      <rect x="267" y="88" width="44" height="5" rx="2" fill="white" opacity="0.5" />
      <path d="M431 73 C460 70, 510 76, 547 72 C553 72, 555 76, 554 82 C557 130, 553 190, 555 227 C555 233, 551 235, 545 234 C510 237, 460 233, 431 235 C425 235, 423 231, 423 225 C421 190, 425 130, 423 82 C423 76, 425 72, 431 73 Z" fill="none" stroke={BLACK} strokeWidth="2.5" transform="rotate(4 485 150)" />

      <circle cx="140" cy="200" r="40" fill="white" filter="url(#grain)" />
      <ellipse cx="470" cy="190" rx="35" ry="28" fill="white" filter="url(#grain)" />

      <circle cx="325" cy="190" r="22" fill={BLUE} />

      <rect x="195" y="140" width="60" height="8" rx="4" fill={BLACK} />
      <rect x="395" y="140" width="30" height="8" rx="4" fill={BLACK} />

      <rect x="70" y="90" width="90" height="70" rx="6" fill={BLUE} transform="rotate(-2 115 125)" />
      <rect x="84" y="106" width="44" height="4" rx="2" fill="white" />
      <rect x="84" y="116" width="30" height="4" rx="2" fill="white" opacity="0.5" />

      <circle cx="30" cy="50" r="4" fill={BLUE} />
      <circle cx="570" cy="260" r="5" fill={BLACK} />
      <circle cx="300" cy="20" r="3" fill="white" />
    </svg>
  );
}

function IllustrationUpload() {
  return (
    <svg viewBox="0 0 600 300" fill="none" className="mx-auto w-full max-w-[600px]">
      <path d="M193 43 C270 40, 360 46, 437 42 C443 42, 445 46, 444 52 C447 130, 443 210, 445 257 C445 263, 441 265, 435 264 C360 267, 270 263, 193 265 C187 265, 185 261, 185 255 C183 210, 187 130, 185 52 C185 46, 187 42, 193 43 Z" fill="none" stroke={BLACK} strokeWidth="2.5" transform="rotate(-1 310 150)" />

      <rect x="210" y="70" width="100" height="130" rx="6" fill={BLACK} transform="rotate(2 260 135)" />
      <rect x="224" y="90" width="50" height="4" rx="2" fill="white" />
      <rect x="224" y="100" width="36" height="4" rx="2" fill="white" opacity="0.5" />
      <rect x="224" y="110" width="60" height="4" rx="2" fill="white" opacity="0.3" />

      <rect x="350" y="70" width="80" height="100" rx="6" fill="white" transform="rotate(-3 390 120)" />
      <rect x="364" y="88" width="40" height="4" rx="2" fill={BLACK} opacity="0.15" />
      <rect x="364" y="98" width="52" height="4" rx="2" fill={BLACK} opacity="0.1" />

      <circle cx="120" cy="130" r="55" fill="white" filter="url(#grain)" />

      <rect x="260" y="210" width="100" height="36" rx="6" fill={BLUE} />
      <path d="M310 218 L304 228 L316 228 Z" fill="white" />

      <circle cx="540" cy="40" r="5" fill={BLUE} />
      <circle cx="70" cy="260" r="4" fill={BLACK} />
      <circle cx="500" cy="280" r="3" fill="white" />
      <circle cx="160" cy="30" r="3" fill={BLUE} />
    </svg>
  );
}

function IllustrationSearch() {
  return (
    <svg viewBox="0 0 600 300" fill="none" className="mx-auto w-full max-w-[600px]">
      <path d="M121 33 C230 30, 380 36, 487 32 C493 32, 495 36, 494 42 C497 120, 493 210, 495 267 C495 273, 491 275, 485 274 C380 277, 230 273, 121 275 C115 275, 113 271, 113 265 C111 210, 115 120, 113 42 C113 36, 115 32, 121 33 Z" fill="none" stroke={BLACK} strokeWidth="2.5" transform="rotate(-1 300 150)" />

      <rect x="140" y="56" width="200" height="32" rx="6" fill={BLACK} />
      <rect x="154" y="68" width="80" height="5" rx="2" fill="white" />
      <circle cx="326" cy="72" r="10" fill={BLUE} />

      <rect x="140" y="108" width="140" height="60" rx="6" fill="white" transform="rotate(1 210 138)" />
      <rect x="154" y="122" width="70" height="4" rx="2" fill={BLACK} opacity="0.15" />
      <rect x="154" y="132" width="100" height="4" rx="2" fill={BLACK} opacity="0.1" />

      <rect x="140" y="180" width="140" height="60" rx="6" fill="white" />
      <rect x="154" y="194" width="70" height="4" rx="2" fill={BLACK} opacity="0.15" />
      <rect x="154" y="204" width="100" height="4" rx="2" fill={BLACK} opacity="0.1" />

      <rect x="300" y="108" width="170" height="132" rx="8" fill={BLACK} />
      <rect x="318" y="126" width="80" height="6" rx="3" fill="white" />
      <rect x="318" y="142" width="134" height="5" rx="2" fill="white" opacity="0.5" />
      <rect x="318" y="154" width="110" height="5" rx="2" fill="white" opacity="0.3" />
      <rect x="318" y="206" width="60" height="20" rx="4" fill={BLUE} />
      <rect x="330" y="213" width="36" height="4" rx="2" fill="white" />

      <ellipse cx="80" cy="160" rx="50" ry="70" fill="white" filter="url(#grain)" />

      <circle cx="560" cy="40" r="4" fill={BLUE} />
      <circle cx="80" cy="270" r="3" fill={BLACK} />
      <circle cx="530" cy="260" r="5" fill="white" />
    </svg>
  );
}

function IllustrationSuccess() {
  return (
    <svg viewBox="0 0 600 300" fill="none" className="mx-auto w-full max-w-[600px]">
      <path d="M300 31 C370 28, 420 70, 418 150 C422 220, 380 270, 300 268 C230 272, 178 230, 180 150 C178 70, 220 34, 300 31 Z" fill="none" stroke={BLACK} strokeWidth="2.5" />
      <rect x="220" y="70" width="160" height="160" rx="10" fill={BLACK} transform="rotate(-2 300 150)" />
      <rect x="240" y="96" width="70" height="5" rx="2" fill="white" />
      <rect x="240" y="108" width="50" height="5" rx="2" fill="white" opacity="0.5" />
      <circle cx="300" cy="170" r="30" fill={BLUE} />
      <path
        d="M286 170 L296 180 L316 158"
        stroke="white"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <ellipse cx="130" cy="100" rx="60" ry="45" fill="white" filter="url(#grain)" />

      <rect x="440" y="200" width="70" height="60" rx="8" fill="white" transform="rotate(3 475 230)" />
      <rect x="454" y="216" width="34" height="4" rx="2" fill={BLACK} opacity="0.15" />
      <rect x="454" y="226" width="24" height="4" rx="2" fill={BLACK} opacity="0.1" />

      <circle cx="540" cy="60" r="5" fill={BLUE} />
      <circle cx="60" cy="250" r="4" fill={BLACK} />
      <circle cx="500" cy="280" r="3" fill="white" />
      <circle cx="100" cy="200" r="3" fill={BLUE} />
    </svg>
  );
}

const MODES = [
  {
    name: "Solid Blue",
    hex: BLUE,
    label: "Blue 60",
    Swatch: SwatchSolidBlue,
    usage: "Primary accent. Buttons, key focal points, interactive highlights. Always flat — never apply grain.",
    role: "Draws the eye. Use sparingly so it stays powerful.",
  },
  {
    name: "Solid Black",
    hex: BLACK,
    label: "Black fill",
    Swatch: SwatchSolidBlack,
    usage: "Medium and small shapes — cards, side panels, secondary containers. Should never exceed ~45% of the illustration's visual density.",
    role: "Grounds the composition with weight. Keep it secondary so black UI buttons still pop.",
  },
  {
    name: "Black Outline",
    hex: BLACK,
    label: "Black stroke",
    Swatch: SwatchBlackOutline,
    usage: "The largest structural shape (the outermost frame or container) uses black stroke only. Prevents black from dominating.",
    role: "Gives structure without weight. Use for the biggest shape; fill smaller ones solid.",
  },
  {
    name: "Grain",
    hex: "N/A",
    label: "Pure Noise",
    Swatch: SwatchGrain,
    usage: "Texture element that partially overlaps other shapes. Never fully covers another shape — always offset so both are visible.",
    role: "Adds depth and atmosphere. Creates layered, tactile feel.",
  },
  {
    name: "White",
    hex: "#ffffff",
    label: "White",
    Swatch: SwatchWhite,
    usage: "Detail lines inside dark fills, negative-space cutouts, content indicators, and open backgrounds.",
    role: "Creates contrast and breathing room. Suggests content without spelling it out.",
  },
];

export function FlowBoardView() {
  const setView = useStore((s) => s.setView);

  return (
    <div className="h-screen overflow-y-auto bg-white text-gray-900 print:bg-white">
      <GrainDefs />

      <header className="sticky top-0 z-30 flex items-center gap-4 border-b bg-white px-6 py-3 print:hidden">
        <button
          onClick={() => setView("knowledge-bases")}
          className="text-[14px] text-blue-600 hover:underline"
        >
          &larr; Prototype
        </button>
        <span className="text-[14px] text-gray-300">|</span>
        <span className="text-[14px] font-medium">Illustration style guide</span>
      </header>

      <div className="mx-auto max-w-[960px] px-6 py-10">
        <h1 className="mb-2 text-[24px] font-bold tracking-tight">
          Illustration style guide
        </h1>
        <p className="mb-10 max-w-[600px] text-[14px] leading-relaxed text-gray-500">
          Five fill modes. Solid black is welcome on medium and small shapes, but should
          never dominate — keep it under ~45% of visual density. The largest container
          uses an outline so black UI buttons still stand out.
        </p>

        <section className="mb-14">
          <h2 className="mb-1 text-[14px] font-bold uppercase tracking-widest text-gray-400">
            Reference — the original
          </h2>
          <p className="mt-2 mb-4 text-[14px] text-gray-500">
            The Block illustration that set the direction. Overlapping solid fills,
            no outlines, white negative space, blue as accent.
          </p>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-6">
            <OriginalBlockReference />
          </div>
        </section>

        <section className="mb-14">
          <h2 className="mb-1 text-[14px] font-bold uppercase tracking-widest text-gray-400">
            Color modes
          </h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {MODES.map(({ name, hex, label, Swatch, usage, role }) => (
              <div key={name}>
                <div className="mb-3 w-full overflow-hidden rounded-lg">
                  <Swatch />
                </div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[16px] font-bold">{name}</span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[12px] text-gray-500">
                    {label}
                  </span>
                </div>
                <p className="mb-1 text-[14px] leading-relaxed text-gray-600">
                  {usage}
                </p>
                <p className="text-[14px] italic text-gray-400">{role}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-14">
          <h2 className="mb-1 text-[14px] font-bold uppercase tracking-widest text-gray-400">
            Rules
          </h2>
          <ul className="mt-4 space-y-3 text-[14px] leading-relaxed text-gray-700">
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-bold text-white">
                1
              </span>
              <span>
                <strong>Black under 45%.</strong> Solid black is fine on medium and small shapes
                (cards, side panels, detail containers). The largest structural shape uses an
                outline (stroke only) to keep black from dominating. Black should never exceed
                ~45% of the illustration's visual density.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-bold text-white">
                2
              </span>
              <span>
                <strong>Blue is the accent.</strong> Use it once or twice per composition.
                If everything is blue, nothing is.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-bold text-white">
                3
              </span>
              <span>
                <strong>Grain only partially overlaps.</strong> The grain shape should
                always be offset so it only partially covers neighboring shapes. Never
                fully overlap — both elements must remain visible.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-bold text-white">
                4
              </span>
              <span>
                <strong>White is versatile.</strong> Use it for detail lines inside dark
                fills, negative-space cutouts, open backgrounds, and standalone shapes
                that need contrast against dark neighbors.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-bold text-white">
                5
              </span>
              <span>
                <strong>Overlap shapes.</strong> Depth comes from layering fills and outlines,
                not from drop shadows.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-bold text-white">
                6
              </span>
              <span>
                <strong>Impressionistic, not literal.</strong> Compositions should be
                asymmetrical and abstract. Suggest the concept rather than depicting it
                perfectly. Tilt and rotate some shapes — not everything needs to be
                horizontal or vertical. Off-center layouts, unexpected proportions.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-bold text-white">
                7
              </span>
              <span>
                <strong>Floating dots.</strong> Scatter small circles (blue, black, or
                white) around compositions. They add funkiness and visual rhythm without
                meaning anything specific.
              </span>
            </li>
          </ul>
        </section>

        <section className="mb-14">
          <h2 className="mb-1 text-[14px] font-bold uppercase tracking-widest text-gray-400">
            Compositions
          </h2>
          <p className="mt-2 mb-6 text-[14px] text-gray-500">
            Example arrangements showing how outlined black, grain, blue, and white layer together.
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <CompositionA />
              </div>
              <p className="mt-2 text-[14px] text-gray-500">
                Outlined frame, solid black panel, blue accent, grain circle behind.
              </p>
            </div>
            <div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <CompositionB />
              </div>
              <p className="mt-2 text-[14px] text-gray-500">
                Outlined circle, solid black interior, grain ellipse, blue center.
              </p>
            </div>
            <div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <CompositionC />
              </div>
              <p className="mt-2 text-[14px] text-gray-500">
                Outlined frame, solid black column, blue column, grain circle bridging.
              </p>
            </div>
            <div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <CompositionD />
              </div>
              <p className="mt-2 text-[14px] text-gray-500">
                Outlined frame, solid black + blue headers, grain ellipse, white detail.
              </p>
            </div>
          </div>
        </section>

        <section className="mb-14">
          <h2 className="mb-1 text-[14px] font-bold uppercase tracking-widest text-gray-400">
            Grain — overlap test
          </h2>
          <p className="mt-2 mb-6 text-[14px] text-gray-500">
            How grain interacts with outlined black vs solid black.
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="rounded-lg border border-gray-100 bg-white p-6">
                <svg viewBox="0 0 400 240" fill="none" className="mx-auto w-full max-w-[400px]">
                  <path d="M141 23 C190 20, 260 26, 307 22 C313 22, 315 26, 314 32 C317 90, 313 160, 315 197 C315 203, 311 205, 305 204 C260 207, 190 203, 141 205 C135 205, 133 201, 133 195 C131 160, 135 90, 133 32 C133 26, 135 22, 141 23 Z" fill="none" stroke={BLACK} strokeWidth="2.5" />
                  <rect x="60" y="30" width="160" height="160" rx="10" fill="white" filter="url(#grain)" />
                </svg>
              </div>
              <p className="mt-2 text-[14px] text-gray-500">
                Grain over outlined black — outline stays visible through the noise texture.
              </p>
            </div>
            <div>
              <div className="rounded-lg border border-gray-100 bg-white p-6">
                <svg viewBox="0 0 400 240" fill="none" className="mx-auto w-full max-w-[400px]">
                  <rect x="131" y="21" width="178" height="178" rx="10" fill={BLACK} />
                  <rect x="60" y="30" width="160" height="160" rx="10" fill="white" filter="url(#grain)" />
                </svg>
              </div>
              <p className="mt-2 text-[14px] text-gray-500">
                Grain over solid black — the noise partially covers the fill, creating a rough edge where they meet.
              </p>
            </div>
          </div>
        </section>

        <section className="mb-14">
          <h2 className="mb-1 text-[14px] font-bold uppercase tracking-widest text-gray-400">
            Small-scale examples
          </h2>
          <p className="mt-2 mb-6 text-[14px] text-gray-500">
            Icons, badges, and compact illustrations use the same modes.
          </p>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
            <IconExample />
          </div>
        </section>

        <section className="mb-14">
          <h2 className="mb-1 text-[14px] font-bold uppercase tracking-widest text-gray-400">
            Palette reference
          </h2>
          <div className="mt-4 overflow-hidden rounded-lg border border-gray-100">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="px-4 py-2 font-medium text-gray-500">Mode</th>
                  <th className="px-4 py-2 font-medium text-gray-500">Hex</th>
                  <th className="px-4 py-2 font-medium text-gray-500">Render</th>
                  <th className="px-4 py-2 font-medium text-gray-500">Preview</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="px-4 py-3">Solid Blue</td>
                  <td className="px-4 py-3 font-mono text-gray-500">{BLUE}</td>
                  <td className="px-4 py-3 text-gray-400">fill</td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-block h-6 w-12 rounded"
                      style={{ backgroundColor: BLUE }}
                    />
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-3">Black Outline</td>
                  <td className="px-4 py-3 font-mono text-gray-500">{BLACK}</td>
                  <td className="px-4 py-3 text-gray-400">stroke only</td>
                  <td className="px-4 py-3">
                    <svg viewBox="0 0 48 24" className="inline-block h-6 w-12">
                      <path
                        d="M5 2 C15 1, 33 3, 43 2 C46 2, 47 4, 47 7 C47 12, 47 17, 47 19 C47 22, 45 23, 42 23 C33 24, 15 22, 5 23 C2 23, 1 21, 1 18 C1 13, 1 8, 1 5 C1 3, 2 2, 5 2 Z"
                        fill="none"
                        stroke={BLACK}
                        strokeWidth="1.5"
                      />
                    </svg>
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-3">Solid Black</td>
                  <td className="px-4 py-3 font-mono text-gray-500">{BLACK}</td>
                  <td className="px-4 py-3 text-gray-400">fill, &le;45% density</td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-block h-6 w-12 rounded"
                      style={{ backgroundColor: BLACK }}
                    />
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-3">Grain</td>
                  <td className="px-4 py-3 text-gray-400">N/A</td>
                  <td className="px-4 py-3 font-mono text-gray-500">
                    feTurbulence desaturated
                  </td>
                  <td className="px-4 py-3">
                    <svg viewBox="0 0 48 24" className="inline-block h-6 w-12">
                      <rect
                        width="48"
                        height="24"
                        rx="4"
                        fill="white"
                        filter="url(#grain)"
                      />
                    </svg>
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3">White</td>
                  <td className="px-4 py-3 font-mono text-gray-500">#ffffff</td>
                  <td className="px-4 py-3 text-gray-400">fill</td>
                  <td className="px-4 py-3">
                    <span className="inline-block h-6 w-12 rounded border border-gray-200 bg-white" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section className="mb-14">
          <h2 className="mb-1 text-[14px] font-bold uppercase tracking-widest text-gray-400">
            Illustration gallery — for review
          </h2>
          <p className="mt-2 mb-6 text-[14px] text-gray-500">
            Five illustrations built with these rules. Critique and refine.
          </p>

          <div className="space-y-8">
            <div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-6">
                <IllustrationEmptyState />
              </div>
              <h3 className="mt-3 text-[16px] font-bold">1 — Empty state</h3>
              <p className="text-[14px] text-gray-500">
                Nothing here yet. A lone document waiting to be filled.
              </p>
            </div>

            <div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-6">
                <IllustrationConnected />
              </div>
              <h3 className="mt-3 text-[16px] font-bold">2 — Connected</h3>
              <p className="text-[14px] text-gray-500">
                Nodes linked together. A system in motion.
              </p>
            </div>

            <div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-6">
                <IllustrationUpload />
              </div>
              <h3 className="mt-3 text-[16px] font-bold">3 — Upload</h3>
              <p className="text-[14px] text-gray-500">
                Files arriving into the system. Ingestion in progress.
              </p>
            </div>

            <div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-6">
                <IllustrationSearch />
              </div>
              <h3 className="mt-3 text-[16px] font-bold">4 — Search</h3>
              <p className="text-[14px] text-gray-500">
                Looking through knowledge. Answers surfacing.
              </p>
            </div>

            <div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-6">
                <IllustrationSuccess />
              </div>
              <h3 className="mt-3 text-[16px] font-bold">5 — Success</h3>
              <p className="text-[14px] text-gray-500">
                Task complete. Everything in its place.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
