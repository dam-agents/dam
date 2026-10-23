/** Raw content returned by artifactLibrary.getContent */
export const artifactContents: Record<string, string> = {
  "art-1": `# Spring 2025 Campaign Brief

## Objective
Launch the Spring collection with a refreshed visual identity that feels warm, organic, and approachable.

## Key Deliverables
- Hero banner (desktop + mobile)
- Instagram carousel (6 slides)
- Email header
- Product page lifestyle shots
- Packaging inserts

## Color Direction
- Primary: Sage (#87A878) + Terracotta (#C4785B)
- Accent: Warm cream (#F5F0E8)
- Avoid: Cool blues, neon anything

## Photography Notes
- Natural light, golden hour preferred
- Lifestyle over product-on-white
- Diverse casting — already confirmed with talent agency
`,
  "art-2": `# Logo Usage Guidelines

## Clear Space
Minimum clear space around the logo equals the height of the logomark "d" character.

## Minimum Size
- Print: 24mm wide minimum
- Digital: 80px wide minimum

## Don'ts
- Don't stretch or skew
- Don't place on busy backgrounds without the container
- Don't use the old teal version (retired Q4 2024)
- Don't add drop shadows or effects

## File Formats Available
- SVG (preferred for web)
- PNG @1x, @2x, @3x (with transparency)
- PDF (for print)
- EPS (for vendors)
`,
  "art-4": `# Typography System

## Primary Typeface: Founders Grotesk
- Headlines: Medium, -0.02em tracking
- Body: Regular, 16px/1.5 line-height
- Captions: Regular, 13px, muted color

## Secondary Typeface: Tiempos Text
- Used for editorial content, long-form
- Pull quotes: Light Italic, 24px

## Hierarchy
| Level | Face | Size | Weight |
|-------|------|------|--------|
| H1 | Founders | 48px | Medium |
| H2 | Founders | 32px | Medium |
| H3 | Founders | 24px | Medium |
| Body | Founders | 16px | Regular |
| Caption | Founders | 13px | Regular |
| Editorial | Tiempos | 18px | Regular |
`,
  "art-6": `# Brand Color Tokens

## Primary Palette
$color-sage-50: #f4f7f3;
$color-sage-100: #e5ede3;
$color-sage-500: #87A878;
$color-sage-700: #5c7a50;
$color-sage-900: #2d3d27;

$color-terracotta-50: #fdf5f2;
$color-terracotta-100: #f9e8e0;
$color-terracotta-500: #C4785B;
$color-terracotta-700: #9e5a3f;
$color-terracotta-900: #4d2b1e;

## Neutrals
$color-cream: #F5F0E8;
$color-warm-white: #FEFDFB;
$color-charcoal: #2C2926;
$color-stone-400: #A39E97;
$color-stone-600: #6B6560;

## Semantic
$color-success: #4CAF50;
$color-warning: #F5A623;
$color-error: #D64545;
`,
  "art-7": `# Q1 2025 Design Review

**Period:** Jan 6 – Mar 28, 2025
**Projects completed:** 14

## Highlights
- Spring campaign visual system finalized
- Packaging redesign shipped to printer
- Website hero refresh (A/B test winner deployed)
- Social media template library expanded to 60+ templates
- Brand guidelines v3.0 published

## What's Next (Q2)
- Summer campaign concepting
- Product photography reshoots (new lighting style)
- Trade show booth design
- Email template refresh
`,
  "art-8": `# Icon Design Specifications

## Grid
- 24x24px canvas
- 2px stroke weight
- 2px corner radius (rounded joins)
- 2px padding from edge

## Style Rules
- Outlined style only (no filled variants)
- Consistent 2px stroke — never thinner
- Round line caps and joins
- Optical alignment over mathematical

## Naming Convention
icon-[category]-[name].svg
Example: icon-nav-home.svg, icon-action-download.svg

## Export
- SVG with viewBox="0 0 24 24"
- No embedded styles (use currentColor)
- Optimized with SVGO
`,
  "art-9": `Photography Direction — Spring 2025

SHOT LIST:

1. Hero banner — model in sage linen, golden hour, outdoor
2. Product flat-lay — candles + books + ceramic on cream backdrop
3. Lifestyle — kitchen scene, morning light, warm tones
4. Detail — texture close-up, fabric grain visible
5. Editorial — full-page portrait, Tiempos overlay text

LIGHTING:
- Natural light strongly preferred
- If studio: warm gels (CTO 1/4), large softbox key
- Avoid harsh shadows on product

POST-PROCESSING:
- Lift shadows slightly (+15)
- Warm white balance (6200K)
- Desaturate blues by 20%
- Light grain overlay (Portra 400 emulation)
- Export: sRGB for web, Adobe RGB for print
`,
  "art-12": `# Color Palette Test Results

| Palette | CTR (email) | CTR (social) | Brand recall | Winner |
|---------|-------------|--------------|--------------|--------|
| Warm sage + terracotta | 4.2% | 3.8% | 72% | ✓ |
| Cool mint + navy | 3.1% | 2.9% | 58% | |
| Warm coral + cream | 3.8% | 4.1% | 65% | |
| Neutral stone + gold | 2.7% | 2.4% | 51% | |

**Recommendation:** Warm sage + terracotta. Best overall brand recall and strong click-through. The warmth feels approachable while sage differentiates from competitors' blue/teal palettes.

**Runner-up note:** Warm coral performed well on social but felt less distinctive in brand recall testing.
`,
};

/** HTML previews returned by artifactLibrary.preview (for renderable kinds) */
export const artifactPreviews: Record<string, string> = {
  "art-1": `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Spring 2025 Campaign Brief</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; background: #fff; color: #1a1a1a; line-height: 1.6; }
  h1 { font-size: 24px; font-weight: 700; margin-bottom: 24px; }
  h2 { font-size: 18px; font-weight: 600; margin-top: 32px; margin-bottom: 12px; color: #333; }
  ul { padding-left: 20px; margin-bottom: 16px; }
  li { margin-bottom: 6px; font-size: 15px; }
  .color-swatch { display: inline-block; width: 16px; height: 16px; border-radius: 4px; vertical-align: middle; margin-right: 8px; border: 1px solid #e5e5e5; }
</style>
</head>
<body>
<h1>Spring 2025 Campaign Brief</h1>
<h2>Objective</h2>
<p>Launch the Spring collection with a refreshed visual identity that feels warm, organic, and approachable.</p>
<h2>Key Deliverables</h2>
<ul>
<li>Hero banner (desktop + mobile)</li>
<li>Instagram carousel (6 slides)</li>
<li>Email header</li>
<li>Product page lifestyle shots</li>
<li>Packaging inserts</li>
</ul>
<h2>Color Direction</h2>
<ul>
<li><span class="color-swatch" style="background:#87A878"></span>Primary: Sage (#87A878)</li>
<li><span class="color-swatch" style="background:#C4785B"></span>Primary: Terracotta (#C4785B)</li>
<li><span class="color-swatch" style="background:#F5F0E8"></span>Accent: Warm cream (#F5F0E8)</li>
</ul>
<p style="margin-top:12px;color:#666;">Avoid: Cool blues, neon anything</p>
<h2>Photography Notes</h2>
<ul>
<li>Natural light, golden hour preferred</li>
<li>Lifestyle over product-on-white</li>
<li>Diverse casting — already confirmed with talent agency</li>
</ul>
</body>
</html>`,
  "art-3": `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Brand Asset Library</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px; background: #fafafa; }
  h1 { font-size: 20px; margin-bottom: 24px; color: #1a1a1a; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .card { background: white; border: 1px solid #e5e5e5; border-radius: 8px; padding: 20px; }
  .card h3 { font-size: 13px; color: #666; font-weight: 500; margin-bottom: 8px; }
  .card .big { font-size: 28px; font-weight: 700; color: #1a1a1a; }
</style>
</head>
<body>
  <h1>Brand Asset Overview</h1>
  <div class="grid">
    <div class="card"><h3>Total Assets</h3><p class="big">1,247</p></div>
    <div class="card"><h3>This Week</h3><p class="big">36 new</p></div>
    <div class="card"><h3>Shared</h3><p class="big">84 links</p></div>
  </div>
</body>
</html>`,
  "art-5": `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Color Palette Preview</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; background: white; }
  .palette { display: flex; gap: 8px; margin: 16px 0; }
  .swatch { width: 80px; height: 80px; border-radius: 12px; display: flex; align-items: end; padding: 8px; font-size: 11px; color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.3); }
  h2 { font-size: 16px; margin-bottom: 4px; }
  p { font-size: 13px; color: #666; }
</style>
</head>
<body>
<h2>Spring 2025 — Primary Palette</h2>
<p>Warm, organic, approachable</p>
<div class="palette">
  <div class="swatch" style="background:#87A878">Sage</div>
  <div class="swatch" style="background:#C4785B">Terracotta</div>
  <div class="swatch" style="background:#F5F0E8;color:#666;text-shadow:none">Cream</div>
  <div class="swatch" style="background:#2C2926">Charcoal</div>
  <div class="swatch" style="background:#A39E97">Stone</div>
</div>
</body>
</html>`,
  "art-11": `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Font Pairing Results</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px; background: white; }
  h1 { font-size: 18px; margin-bottom: 20px; color: #1a1a1a; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #e5e5e5; }
  th { background: #f8f8f8; font-weight: 600; color: #333; }
  .winner { background: #e8f5e9; }
  .check { color: #2e7d32; font-weight: bold; }
  p { margin-top: 16px; font-size: 14px; color: #444; }
  strong { color: #1a1a1a; }
</style>
</head>
<body>
<h1>Font Pairing Test — Results</h1>
<table>
  <thead><tr><th>Pairing</th><th>Readability</th><th>Brand Fit</th><th>Preference</th><th>Winner</th></tr></thead>
  <tbody>
    <tr><td>Founders + Tiempos</td><td>92%</td><td>88%</td><td>41%</td><td></td></tr>
    <tr class="winner"><td>Founders + Söhne</td><td>94%</td><td>91%</td><td>47%</td><td class="check">✓</td></tr>
    <tr><td>Untitled Sans + Tiempos</td><td>89%</td><td>79%</td><td>8%</td><td></td></tr>
    <tr><td>Inter + Lora</td><td>96%</td><td>62%</td><td>4%</td><td></td></tr>
  </tbody>
</table>
<p><strong>Recommendation:</strong> Founders Grotesk + Söhne — highest brand alignment with strong readability. The geometric consistency feels cohesive.</p>
</body>
</html>`,
};

export const artifactFolders = [
  {
    id: "folder-1",
    name: "Campaign Assets",
    createdAt: "2024-02-01T10:00:00.000Z",
    updatedAt: "2024-03-14T10:00:00.000Z",
  },
  {
    id: "folder-2",
    name: "Brand System",
    createdAt: "2024-01-20T10:00:00.000Z",
    updatedAt: "2024-03-10T10:00:00.000Z",
  },
  {
    id: "folder-exp-1",
    name: "Experiments / Color Palette Testing",
    createdAt: "2024-03-01T10:00:00.000Z",
    updatedAt: "2024-03-13T10:00:00.000Z",
  },
];

const AGENT_ID = "a1b2c3d4-0001-4000-8000-000000000001";
const AGENT_ID_2 = "a1b2c3d4-0002-4000-8000-000000000002";
const AGENT_ID_3 = "a1b2c3d4-0003-4000-8000-000000000003";
const AGENT_ID_KB = "a1b2c3d4-0004-4000-8000-000000000004";
const AGENT_ID_EXP = "a1b2c3d4-0005-4000-8000-000000000005";

// Recent timestamps (relative to "now" so they always appear as new)
const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

export const artifacts = [
  {
    id: "art-1",
    title: "Spring 2025 Campaign Brief",
    slug: "spring-2025-brief",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "spring-2025-brief.md",
    sizeBytes: 4200,
    version: 3,
    folderId: "folder-1",
    agentId: AGENT_ID,
    visibility: "private",
    expiresAt: null,
    viewCount: 8,
    shareUrl: null,
    createdAt: hoursAgo(2),
    updatedAt: hoursAgo(2),
  },
  {
    id: "art-2",
    title: "Logo Usage Guidelines",
    slug: "logo-usage",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "logo-usage.md",
    sizeBytes: 8100,
    version: 2,
    folderId: "folder-2",
    agentId: AGENT_ID_KB,
    visibility: "public",
    expiresAt: null,
    viewCount: 12,
    shareUrl: "https://share.example.com/logo",
    createdAt: hoursAgo(1),
    updatedAt: hoursAgo(1),
  },
  {
    id: "art-3",
    title: "Brand Asset Overview",
    slug: "asset-overview",
    kind: "html",
    contentType: "text/html",
    fileName: "asset-overview.html",
    sizeBytes: 24600,
    version: 5,
    folderId: null,
    agentId: AGENT_ID_KB,
    visibility: "public",
    expiresAt: null,
    viewCount: 47,
    shareUrl: "https://share.example.com/overview",
    createdAt: hoursAgo(3),
    updatedAt: hoursAgo(3),
  },
  {
    id: "art-4",
    title: "Typography System",
    slug: "typography-system",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "typography.md",
    sizeBytes: 18400,
    version: 4,
    folderId: "folder-2",
    agentId: AGENT_ID,
    visibility: "public",
    expiresAt: null,
    viewCount: 31,
    shareUrl: "https://share.example.com/type",
    createdAt: "2024-02-20T08:00:00.000Z",
    updatedAt: "2024-03-12T11:00:00.000Z",
  },
  {
    id: "art-5",
    title: "Color Palette Preview",
    slug: "color-palette",
    kind: "html",
    contentType: "text/html",
    fileName: "color-palette.html",
    sizeBytes: 12300,
    version: 1,
    folderId: "folder-2",
    agentId: AGENT_ID,
    visibility: "private",
    expiresAt: null,
    viewCount: 5,
    shareUrl: null,
    createdAt: "2024-03-05T09:00:00.000Z",
    updatedAt: "2024-03-05T09:00:00.000Z",
  },
  {
    id: "art-6",
    title: "Brand Color Tokens",
    slug: "color-tokens",
    kind: "code",
    contentType: "text/plain",
    fileName: "color-tokens.scss",
    sizeBytes: 3200,
    version: 1,
    folderId: "folder-2",
    agentId: null,
    visibility: "private",
    expiresAt: null,
    viewCount: 2,
    shareUrl: null,
    createdAt: "2024-03-11T15:00:00.000Z",
    updatedAt: "2024-03-11T15:00:00.000Z",
  },
  {
    id: "art-7",
    title: "Q1 2025 Design Review",
    slug: "q1-design-review",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "q1-review.md",
    sizeBytes: 3800,
    version: 2,
    folderId: "folder-1",
    agentId: AGENT_ID,
    visibility: "private",
    expiresAt: null,
    viewCount: 15,
    shareUrl: null,
    createdAt: "2024-02-28T10:00:00.000Z",
    updatedAt: "2024-02-28T10:00:00.000Z",
  },
  {
    id: "art-8",
    title: "Icon Design Specifications",
    slug: "icon-specs",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "icon-specs.md",
    sizeBytes: 15700,
    version: 3,
    folderId: "folder-2",
    agentId: AGENT_ID,
    visibility: "public",
    expiresAt: null,
    viewCount: 22,
    shareUrl: "https://share.example.com/icons",
    createdAt: "2024-03-02T11:00:00.000Z",
    updatedAt: "2024-03-14T08:00:00.000Z",
  },
  {
    id: "art-9",
    title: "Photography Direction",
    slug: "photo-direction",
    kind: "text",
    contentType: "text/plain",
    fileName: "photo-direction.txt",
    sizeBytes: 52400,
    version: 1,
    folderId: "folder-1",
    agentId: AGENT_ID,
    visibility: "private",
    expiresAt: null,
    viewCount: 4,
    shareUrl: null,
    createdAt: "2024-03-13T22:00:00.000Z",
    updatedAt: "2024-03-13T22:00:00.000Z",
  },
  {
    id: "art-10",
    title: "Mood Board — Spring Campaign",
    slug: "mood-board-spring",
    kind: "binary",
    contentType: "image/png",
    fileName: "mood-board-spring.png",
    sizeBytes: 186000,
    version: 2,
    folderId: "folder-1",
    agentId: null,
    visibility: "public",
    expiresAt: null,
    viewCount: 19,
    shareUrl: "https://share.example.com/mood",
    createdAt: "2024-02-15T14:00:00.000Z",
    updatedAt: "2024-03-10T10:00:00.000Z",
  },
  {
    id: "art-11",
    title: "Font Pairing Test Results",
    slug: "font-pairing-results",
    kind: "html",
    contentType: "text/html",
    fileName: "font-results.html",
    sizeBytes: 9800,
    version: 1,
    folderId: "folder-exp-1",
    agentId: AGENT_ID_EXP,
    visibility: "private",
    expiresAt: null,
    viewCount: 6,
    shareUrl: null,
    createdAt: hoursAgo(4),
    updatedAt: hoursAgo(4),
  },
  {
    id: "art-12",
    title: "Color Palette Test Results",
    slug: "color-test-results",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "color-results.md",
    sizeBytes: 6400,
    version: 2,
    folderId: "folder-exp-1",
    agentId: AGENT_ID_EXP,
    visibility: "private",
    expiresAt: null,
    viewCount: 3,
    shareUrl: null,
    createdAt: hoursAgo(5),
    updatedAt: hoursAgo(5),
  },
];
