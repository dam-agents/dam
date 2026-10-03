// Ported from packages/ui flow-board illustration style guide (design/session-3).
// Keep geometry identical so the two can be diffed.
export function GrainDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" className="absolute">
      <defs>
        <filter id="grain" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="2.5"
            numOctaves={5}
            seed={7}
            result="noise"
          />
          <feColorMatrix type="saturate" values="0" in="noise" result="grey" />
          <feComposite operator="in" in="grey" in2="SourceGraphic" />
        </filter>
        <filter id="crayon">
          <feTurbulence
            type="turbulence"
            baseFrequency="0.03"
            numOctaves={4}
            seed={2}
            result="warp"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="warp"
            scale={6}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        <filter id="crayon-sm">
          <feTurbulence
            type="turbulence"
            baseFrequency="0.05"
            numOctaves={3}
            seed={5}
            result="warp"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="warp"
            scale={2}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
