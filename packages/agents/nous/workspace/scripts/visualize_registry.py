#!/usr/bin/env python3
"""Generate an interactive D3.js cross-campaign knowledge graph from the Nous wiki registry.

Reads ~/.nous/wiki/registry.json and per-campaign files to produce a self-contained
HTML visualization showing campaigns, entities, concepts, and parameters as an
interconnected force-directed graph.

Usage:
    python scripts/visualize_registry.py [--wiki <path>] [--output <path>] [--no-open]

    --wiki: path to wiki directory (default: ~/.nous/wiki/)
    --output: output HTML file path (default: ~/.nous/wiki/viz/registry.html)
    --no-open: don't open browser after generation
"""

import argparse
import json
import sys
import webbrowser
from pathlib import Path


HTML_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Nous Registry — Cross-Campaign Knowledge Graph</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: #1a1a2e; font-family: -apple-system, system-ui, sans-serif; overflow: hidden; }}
  #graph {{ width: 100vw; height: 100vh; display: block; }}

  .node {{ cursor: pointer; }}
  .node:hover {{ filter: brightness(1.3); }}
  .link {{ stroke-opacity: 0.5; fill: none; }}
  .link:hover {{ stroke-opacity: 1; }}

  .label {{
    font-size: 10px; fill: #e0e0e0; pointer-events: none;
    text-anchor: middle; dominant-baseline: middle;
  }}
  .label-campaign {{ font-size: 12px; font-weight: 600; fill: #fff; }}

  /* Tooltip */
  .tooltip {{
    position: absolute; background: #16213e; border: 1px solid #0f3460;
    border-radius: 8px; padding: 14px; color: #e0e0e0; font-size: 12px;
    max-width: 420px; pointer-events: none; display: none; z-index: 200;
    line-height: 1.5; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  }}
  .tooltip h3 {{ margin: 0 0 6px; font-size: 14px; color: #fff; }}
  .tooltip .tt-type {{ color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }}
  .tooltip .tt-field {{ margin-top: 8px; }}
  .tooltip .tt-label {{ color: #888; font-size: 10px; }}
  .tooltip .tt-value {{ color: #ccc; margin-top: 2px; }}

  /* Detail panel */
  .detail-panel {{
    position: absolute; top: 16px; right: 16px; width: 360px;
    max-height: calc(100vh - 32px); overflow-y: auto;
    background: #16213e; border: 1px solid #0f3460; border-radius: 8px;
    padding: 20px; color: #e0e0e0; font-size: 12px; z-index: 100;
    display: none; box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  }}
  .detail-panel.visible {{ display: block; }}
  .detail-panel h2 {{ margin: 0 0 4px; font-size: 16px; color: #fff; }}
  .detail-panel .panel-type {{ color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }}
  .detail-panel .panel-section {{ margin-top: 14px; padding-top: 12px; border-top: 1px solid #0f3460; }}
  .detail-panel .panel-section-title {{ color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }}
  .detail-panel .panel-item {{ margin: 4px 0; padding: 4px 8px; background: rgba(255,255,255,0.03); border-radius: 4px; }}
  .detail-panel .panel-close {{
    position: absolute; top: 12px; right: 12px; background: none;
    border: none; color: #888; font-size: 18px; cursor: pointer; padding: 4px 8px;
  }}
  .detail-panel .panel-close:hover {{ color: #fff; }}
  .detail-panel .campaign-date {{ color: #7986cb; font-size: 11px; }}



  /* Rendered markdown in panels */
  .panel-summary {{ color: #ccc; line-height: 1.6; }}
  .md-section-title {{
    color: #90a4ae; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px;
    margin-top: 14px; margin-bottom: 6px; padding-top: 10px;
    border-top: 1px solid #0f3460;
  }}
  .md-section-title:first-child {{ border-top: none; margin-top: 0; padding-top: 0; }}
  .md-para {{ margin: 6px 0; font-size: 12px; color: #ccc; line-height: 1.6; }}
  .md-list {{ margin: 4px 0; padding-left: 16px; }}
  .md-list li {{ margin: 4px 0; font-size: 11px; color: #bbb; line-height: 1.5; }}
  .md-list li strong {{ color: #e0e0e0; }}
  .md-kv {{ margin: 3px 0; font-size: 11px; color: #bbb; }}
  .md-kv strong {{ color: #90a4ae; }}

  /* View toggle */
  .view-toggle {{
    position: absolute; top: 16px; left: 50%; transform: translateX(-50%); z-index: 70;
    display: flex; gap: 0;
  }}
  .view-btn {{
    background: #16213e; border: 1px solid #0f3460; color: #e0e0e0;
    padding: 8px 16px; cursor: pointer; font-size: 12px; transition: all 0.2s;
  }}
  .view-btn:first-child {{ border-radius: 6px 0 0 6px; }}
  .view-btn:last-child {{ border-radius: 0 6px 6px 0; }}
  .view-btn.active {{ background: #0f3460; color: #fff; font-weight: 600; }}

  /* Cost badge on campaign nodes */
  .cost-badge {{
    font-size: 9px; fill: #ffab40; font-weight: 600;
    text-anchor: middle; pointer-events: none;
  }}

  /* Opportunities list view */
  #opp-list-container {{
    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    overflow-y: auto; padding: 60px 32px 24px;
    background: #1a1a2e; z-index: 40;
  }}
  .opp-header {{
    color: #888; font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.8px; margin-bottom: 16px; padding-bottom: 8px;
    border-bottom: 1px solid #0f3460;
    display: flex; align-items: center; gap: 16px;
  }}
  .opp-cluster-bar {{
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
    padding: 12px 0 16px; border-bottom: 1px solid #0f3460; margin-bottom: 16px;
  }}
  .opp-cluster-bar-label {{
    color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
    margin-right: 4px;
  }}
  .opp-cluster-btn {{
    background: #0d1b2a; border: 1px solid #0f3460; color: #aaa;
    padding: 6px 14px; border-radius: 5px; font-size: 11px; cursor: pointer;
    transition: all 0.15s; font-weight: 500;
  }}
  .opp-cluster-btn:hover {{ border-color: #5c6bc0; color: #ccc; }}
  .opp-cluster-btn.active {{ border-color: var(--btn-color, #66bb6a); color: #fff; background: rgba(255,255,255,0.08); font-weight: 600; }}
  .opp-cluster-btn .cluster-dot-inline {{
    display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px;
  }}
  .opp-header .opp-total-cost {{
    float: right; color: #ffab40; font-size: 12px; font-weight: 600;
    text-transform: none; letter-spacing: normal;
  }}
  .opp-card {{
    background: #16213e; border: 1px solid #0f3460; border-radius: 8px;
    padding: 16px 20px; margin-bottom: 12px; transition: border-color 0.2s;
    cursor: pointer;
  }}
  .opp-card:hover {{ border-color: #5c6bc0; }}
  .opp-card-header {{
    display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
  }}
  .opp-card-type {{
    font-size: 9px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.5px; padding: 2px 8px; border-radius: 3px;
  }}
  .opp-card-type.frontier {{ background: #e65100; color: #fff; }}
  .opp-card-type.interaction {{ background: #00695c; color: #fff; }}
  .opp-card-title {{
    font-size: 14px; font-weight: 600; color: #fff; flex: 1;
  }}
  .opp-card-cost {{
    font-size: 13px; font-weight: 700; color: #ffab40;
    white-space: nowrap;
  }}
  .opp-card-meta {{
    display: flex; gap: 16px; font-size: 11px; color: #888; margin-bottom: 10px;
  }}
  .opp-card-body {{
    font-size: 12px; color: #ccc; line-height: 1.6;
  }}
  .opp-card-principles {{
    margin-top: 10px; display: flex; flex-wrap: wrap; gap: 4px;
  }}
  .opp-card-principles .principle-tag {{
    font-size: 9px; background: rgba(121,134,203,0.15); color: #7986cb;
    padding: 2px 6px; border-radius: 3px; font-weight: 600;
  }}
  .opp-card-detail {{
    display: none; margin-top: 12px; padding-top: 12px;
    border-top: 1px solid #0f3460; font-size: 11px; color: #aaa; line-height: 1.6;
  }}
  .opp-card.expanded .opp-card-detail {{ display: block; }}
  .opp-card-detail .detail-section {{
    margin-bottom: 10px;
  }}
  .opp-card-detail .detail-label {{
    color: #888; font-size: 9px; text-transform: uppercase;
    letter-spacing: 0.5px; margin-bottom: 4px;
  }}
  .opp-card-detail .detail-value {{ color: #ccc; }}

  /* Stats bar */
  .stats-bar {{
    position: absolute; bottom: 16px; left: 16px; background: #16213e;
    border: 1px solid #0f3460; border-radius: 8px; padding: 10px 14px;
    color: #e0e0e0; font-size: 11px; z-index: 50; display: flex; gap: 16px;
  }}
  .stats-bar .stat-value {{ font-size: 14px; font-weight: 600; color: #fff; }}
  .stats-bar .stat-label {{ color: #888; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }}

  .node-glow {{
    filter: drop-shadow(0 0 6px rgba(255, 215, 0, 0.8));
  }}

  /* Filter panel */
  .filter-panel {{
    position: absolute; top: 16px; left: 16px; width: 260px;
    max-height: calc(100vh - 32px); overflow-y: auto;
    background: #16213e; border: 1px solid #0f3460; border-radius: 8px;
    padding: 16px; color: #e0e0e0; font-size: 11px; z-index: 60;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  }}
  .filter-panel h4 {{
    margin: 0 0 8px; font-size: 12px; color: #fff; text-transform: uppercase;
    letter-spacing: 0.5px;
  }}
  .filter-step {{ margin-bottom: 14px; }}
  .filter-step-label {{
    color: #888; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px;
    margin-bottom: 6px; display: flex; align-items: center; gap: 6px;
  }}
  .filter-step-num {{
    display: inline-flex; align-items: center; justify-content: center;
    width: 16px; height: 16px; border-radius: 50%; background: #0f3460;
    color: #5c6bc0; font-size: 9px; font-weight: 700;
  }}
  .filter-step-num.done {{ background: #1b5e20; color: #66bb6a; }}
  .filter-select {{
    width: 100%; background: #0d1b2a; border: 1px solid #0f3460; color: #e0e0e0;
    padding: 6px 8px; border-radius: 5px; font-size: 11px; cursor: pointer;
  }}
  .filter-select:focus {{ outline: none; border-color: #5c6bc0; }}
  .entity-chips {{
    display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;
  }}
  .entity-chip {{
    background: #0d1b2a; border: 1px solid #0f3460; color: #aaa;
    padding: 4px 8px; border-radius: 4px; font-size: 10px; cursor: pointer;
    transition: all 0.15s;
  }}
  .entity-chip:hover {{ border-color: #66bb6a; color: #ccc; }}
  .entity-chip.selected {{ background: #1b5e20; border-color: #66bb6a; color: #fff; }}

  /* Cluster groups in filter panel */
  .cluster-group {{
    margin-bottom: 8px; border: 1px solid #0f3460; border-radius: 6px;
    overflow: hidden; transition: border-color 0.2s;
  }}
  .cluster-group.selected {{ border-color: var(--cluster-color, #66bb6a); }}
  .cluster-header {{
    display: flex; align-items: center; gap: 8px; padding: 8px 10px;
    cursor: pointer; transition: background 0.2s;
  }}
  .cluster-header:hover {{ background: rgba(255,255,255,0.03); }}
  .cluster-dot {{
    width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0;
  }}
  .cluster-name {{
    flex: 1; font-size: 11px; color: #ccc; font-weight: 600;
  }}
  .cluster-count {{
    font-size: 9px; color: #888; background: #0d1b2a; padding: 2px 6px;
    border-radius: 3px;
  }}
  .cluster-entities {{
    padding: 0 10px 8px; display: flex; flex-wrap: wrap; gap: 3px;
  }}
  .filter-btn {{
    width: 100%; background: transparent; border: 1px solid #0f3460; color: #888;
    padding: 8px; border-radius: 5px; font-size: 11px; font-weight: 600;
    cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;
    margin-top: 10px; transition: all 0.2s;
  }}
  .filter-btn:hover {{ border-color: #f44336; color: #f44336; }}
  .scope-summary {{
    margin-top: 10px; padding: 8px; background: rgba(255,255,255,0.03);
    border-radius: 5px; font-size: 10px; color: #aaa; line-height: 1.6;
  }}
  .scope-summary .scope-count {{ color: #fff; font-weight: 600; }}

  /* Legend panel */
  .legend-panel {{
    position: absolute; bottom: 16px; right: 16px;
    background: #16213e; border: 1px solid #0f3460; border-radius: 8px;
    padding: 14px 16px; color: #e0e0e0; font-size: 11px; z-index: 50;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4); min-width: 200px;
  }}
  .legend-panel.collapsed {{
    padding: 8px 12px; min-width: auto;
  }}
  .legend-panel.collapsed .legend-body {{ display: none; }}
  .legend-toggle {{
    background: none; border: none; color: #888; font-size: 10px;
    cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;
    padding: 0; display: flex; align-items: center; gap: 6px;
  }}
  .legend-toggle:hover {{ color: #fff; }}
  .legend-section-title {{
    color: #888; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px;
    margin: 10px 0 6px; padding-top: 8px; border-top: 1px solid #0f3460;
  }}
  .legend-section-title:first-child {{ border-top: none; margin-top: 4px; padding-top: 0; }}
  .legend-row {{
    display: flex; align-items: center; gap: 8px; margin: 5px 0;
  }}
  .legend-row span {{ color: #ccc; font-size: 11px; }}
</style>
</head>
<body>
<div class="view-toggle">
  <button class="view-btn active" id="btn-knowledge" onclick="switchView('knowledge')">Knowledge</button>
  <button class="view-btn" id="btn-opportunities" onclick="switchView('opportunities')">Opportunities</button>
</div>
<div id="opp-list-container" style="display:none;"></div>
<div class="tooltip" id="tooltip"></div>
<div class="detail-panel" id="detail-panel">
  <button class="panel-close" onclick="closePanel()">&times;</button>
  <div id="panel-content"></div>
</div>
<div class="filter-panel" id="filter-panel">
  <h4>Registry Explorer</h4>
  <div class="filter-step" id="step-project">
    <div class="filter-step-label"><span class="filter-step-num" id="step1-num">1</span> Project</div>
    <select class="filter-select" id="project-select" onchange="onProjectSelect()">
      <option value="">Select project...</option>
    </select>
  </div>
  <div class="filter-step" id="step-entities" style="display:none;">
    <div class="filter-step-label"><span class="filter-step-num" id="step2-num">2</span> Select entity cluster</div>
    <div id="cluster-groups"></div>
  </div>
  <div id="scope-summary" style="display:none;"></div>
  <button class="filter-btn reset" id="reset-btn" style="display:none;" onclick="resetFilter()">Reset</button>
</div>
<div class="stats-bar" id="stats-bar"></div>
<div class="legend-panel" id="legend-panel">
  <button class="legend-toggle" id="legend-toggle" onclick="toggleLegend()">
    <span id="legend-arrow">&#9662;</span> Legend
  </button>
  <div class="legend-body" id="legend-body">
    <div class="legend-section-title">Nodes</div>
    <div class="legend-row">
      <svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="#78909c" stroke="#b0bec5" stroke-width="1.5"/></svg>
      <span>Campaign</span>
    </div>
    <div class="legend-row">
      <svg width="16" height="16"><polygon points="8,2 14,8 8,14 2,8" fill="#1b5e20" stroke="#66bb6a" stroke-width="1.5"/></svg>
      <span>Entity (colored by cluster)</span>
    </div>
    <div class="legend-row">
      <svg width="16" height="16"><rect x="2" y="2" width="12" height="12" rx="3" ry="3" fill="#1a237e" stroke="#5c6bc0" stroke-width="1.5"/></svg>
      <span>Concept</span>
    </div>
    <div class="legend-row">
      <svg width="16" height="16"><polygon points="8,2 14,13 2,13" fill="#4a148c" stroke="#ce93d8" stroke-width="1.5"/></svg>
      <span>Parameter</span>
    </div>
    <div class="legend-section-title">Edges</div>
    <div class="legend-row">
      <svg width="30" height="8"><line x1="0" y1="4" x2="30" y2="4" stroke="#5c6bc0" stroke-width="1.5"/></svg>
      <span>campaign &rarr; concept</span>
    </div>
    <div class="legend-row">
      <svg width="30" height="8"><line x1="0" y1="4" x2="30" y2="4" stroke="#66bb6a" stroke-width="1.5" stroke-dasharray="4,3"/></svg>
      <span>campaign &rarr; entity</span>
    </div>
    <div class="legend-row">
      <svg width="30" height="8"><line x1="0" y1="4" x2="30" y2="4" stroke="#80cbc4" stroke-width="1.5" stroke-dasharray="2,2"/></svg>
      <span>concept operates_on entity</span>
    </div>
    <div class="legend-row">
      <svg width="30" height="8"><line x1="0" y1="4" x2="30" y2="4" stroke="#ce93d8" stroke-width="1.5" stroke-dasharray="3,2"/></svg>
      <span>concept has_param</span>
    </div>
    <div class="legend-row">
      <svg width="30" height="8"><line x1="0" y1="4" x2="30" y2="4" stroke="#90a4ae" stroke-width="1.5" stroke-dasharray="4,2"/></svg>
      <span>entity &harr; entity (interacts)</span>
    </div>
    <div class="legend-row">
      <svg width="30" height="8"><line x1="0" y1="4" x2="30" y2="4" stroke="#ffab40" stroke-width="1.5" stroke-dasharray="6,2"/></svg>
      <span>shared principles</span>
    </div>
  </div>
</div>
<svg id="graph"></svg>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
// --- Data injected by Python ---
const registryData = {registry_data_json};
const campaignDetails = {campaign_details_json};
const crossEdges = {cross_edges_json};
const retrievalScopes = {retrieval_scopes_json};
const campaignCosts = {campaign_costs_json};
const entityClusters = {entity_clusters_json};

// --- Cluster color palette and mapping ---
const clusterColors = ["#66bb6a", "#42a5f5", "#ffca28", "#ef5350", "#ab47bc", "#26c6da", "#ff7043"];
const clusterFills = ["#1b5e20", "#0d47a1", "#5d4037", "#b71c1c", "#4a148c", "#004d40", "#bf360c"];

// Build node_id → cluster index map
const entityClusterMap = {{}};
entityClusters.forEach(cluster => {{
  cluster.node_ids.forEach(nid => {{
    entityClusterMap[nid] = cluster.id;
  }});
}});

function entityClusterColor(nodeId) {{
  const idx = entityClusterMap[nodeId];
  if (idx == null) return "#66bb6a";
  return clusterColors[idx % clusterColors.length];
}}

function entityClusterFill(nodeId) {{
  const idx = entityClusterMap[nodeId];
  if (idx == null) return "#1b5e20";
  return clusterFills[idx % clusterFills.length];
}}

// --- Graph construction ---
const nodes = [];
const links = [];
const nodeIndex = {{}};

function addNode(id, data) {{
  if (nodeIndex[id]) return nodeIndex[id];
  const node = {{ id, ...data }};
  nodes.push(node);
  nodeIndex[id] = node;
  return node;
}}

function addLink(source, target, data) {{
  links.push({{ source, target, ...data }});
}}

// Build graph from registry
Object.entries(registryData.projects || {{}}).forEach(([repoPath, project]) => {{
  const campaigns = project.campaigns || [];
  const entities = project.entities || [];

  // Sort campaigns by date for timeline positioning
  const sorted = [...campaigns].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  // Add campaign nodes
  sorted.forEach((campaign, idx) => {{
    const cId = `campaign-${{campaign.name}}`;
    addNode(cId, {{
      type: "campaign",
      label: campaign.name,
      date: campaign.date,
      research_question: campaign.research_question,
      timeIndex: idx,
      totalCampaigns: sorted.length,
      conceptCount: (campaign.concepts || []).length,
      paramCount: (campaign.parameters || []).length,
      deadEndCount: (campaign.dead_ends || []).length,
      frontierCount: (campaign.frontiers || []).length,
    }});

    // Add concept nodes and edges
    (campaign.concepts || []).forEach(concept => {{
      const nId = `concept-${{concept.id}}`;
      addNode(nId, {{
        type: "concept",
        label: concept.name,
        conceptId: concept.id,
        campaign: campaign.name,
      }});
      addLink(cId, nId, {{ edgeType: "concept" }});
    }});

    // Add parameter nodes (no direct campaign link — connected via shared-principle edges)
    (campaign.parameters || []).forEach(param => {{
      const nId = `param-${{param.id}}`;
      addNode(nId, {{
        type: "parameter",
        label: param.name,
        paramId: param.id,
        campaign: campaign.name,
      }});
    }});

  }});

  // Add entity nodes — these connect to multiple campaigns
  entities.forEach(entity => {{
    const eId = `entity-${{entity.id}}`;
    addNode(eId, {{
      type: "entity",
      label: entity.name,
      entityId: entity.id,
      campaigns: entity.campaigns || [],
      campaignCount: (entity.campaigns || []).length,
    }});

    // Link entity to each campaign that studied it
    (entity.campaigns || []).forEach(campName => {{
      const cId = `campaign-${{campName}}`;
      if (nodeIndex[cId]) {{
        addLink(cId, eId, {{ edgeType: "entity" }});
      }}
    }});
  }});
}});

// --- Cross-node edges (from explicit relationship fields in concepts.json) ---
crossEdges.forEach(e => {{
  if (nodeIndex[e.source] && nodeIndex[e.target]) {{
    addLink(e.source, e.target, {{ edgeType: e.edgeType, strength: e.strength }});
  }}
}});

// Stats bar — hidden until retrieval scope is shown
document.getElementById("stats-bar").style.display = "none";

// --- Filter-driven retrieval (uses pre-computed scopes from Python) ---
// retrievalScopes: entityName -> [nodeId, ...] — computed by retrieve_wiki_context logic

const projectEntities = {{}};
const projectNames = [];
Object.entries(registryData.projects || {{}}).forEach(([repoPath, project]) => {{
  projectNames.push(repoPath);
  projectEntities[repoPath] = (project.entities || []).map(e => ({{
    name: e.name,
    id: e.id,
    campaigns: e.campaigns || [],
    campaignCount: (e.campaigns || []).length,
  }}));
}});

// Populate project dropdown
const projectSelect = document.getElementById("project-select");
projectNames.forEach(name => {{
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = name.split("/").pop() || name;
  projectSelect.appendChild(opt);
}});

let selectedProject = null;
let selectedEntityNames = new Set();
let filterScopeNodeIds = new Set();
let filterActive = false;

function onProjectSelect() {{
  const val = projectSelect.value;
  if (!val) {{
    document.getElementById("step-entities").style.display = "none";
    filterActive = false;
    applyFilterVisuals();
    document.getElementById("stats-bar").style.display = "none";
    return;
  }}
  selectedProject = val;
  selectedEntityNames.clear();
  document.getElementById("step1-num").classList.add("done");
  document.getElementById("step-entities").style.display = "block";
  document.getElementById("scope-summary").style.display = "none";
  document.getElementById("reset-btn").style.display = "none";

  // Render cluster groups
  const container = document.getElementById("cluster-groups");
  container.innerHTML = "";
  const projectEntityNames = new Set((projectEntities[val] || []).map(e => e.name));

  entityClusters.forEach(cluster => {{
    // Only show clusters that have entities in this project
    const clusterEntitiesInProject = cluster.entities.filter(e => projectEntityNames.has(e));
    if (clusterEntitiesInProject.length === 0) return;

    const color = clusterColors[cluster.id % clusterColors.length];
    const group = document.createElement("div");
    group.className = "cluster-group";
    group.style.setProperty("--cluster-color", color);
    group.dataset.clusterId = cluster.id;

    // Header (click to select/deselect all entities in cluster)
    const header = document.createElement("div");
    header.className = "cluster-header";
    header.innerHTML = `
      <span class="cluster-dot" style="background:${{color}}"></span>
      <span class="cluster-name">${{cluster.label}}</span>
      <span class="cluster-count">${{clusterEntitiesInProject.length}}</span>
    `;
    header.onclick = () => toggleCluster(cluster.id, clusterEntitiesInProject, group);
    group.appendChild(header);

    // Individual entity chips within cluster
    const chipsDiv = document.createElement("div");
    chipsDiv.className = "cluster-entities";
    clusterEntitiesInProject.forEach(name => {{
      const chip = document.createElement("span");
      chip.className = "entity-chip";
      chip.textContent = name;
      chip.dataset.name = name;
      chip.onclick = (evt) => {{
        evt.stopPropagation();
        toggleEntityChip(chip, name);
        updateClusterGroupState(group, clusterEntitiesInProject);
      }};
      chipsDiv.appendChild(chip);
    }});
    group.appendChild(chipsDiv);

    container.appendChild(group);
  }});

  // Show unclustered entities as individual chips below clusters
  const clusteredNames = new Set();
  entityClusters.forEach(c => c.entities.forEach(e => clusteredNames.add(e)));
  const unclustered = [...projectEntityNames].filter(n => !clusteredNames.has(n)).sort();
  if (unclustered.length > 0) {{
    const uDiv = document.createElement("div");
    uDiv.style.cssText = "margin-top:8px;padding-top:8px;border-top:1px solid #0f3460;";
    const uLabel = document.createElement("div");
    uLabel.style.cssText = "font-size:9px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;";
    uLabel.textContent = "Unclustered entities";
    uDiv.appendChild(uLabel);
    const uChips = document.createElement("div");
    uChips.className = "cluster-entities";
    unclustered.forEach(name => {{
      const chip = document.createElement("span");
      chip.className = "entity-chip";
      chip.textContent = name;
      chip.dataset.name = name;
      chip.onclick = (evt) => {{
        evt.stopPropagation();
        toggleEntityChip(chip, name);
      }};
      uChips.appendChild(chip);
    }});
    uDiv.appendChild(uChips);
    container.appendChild(uDiv);
  }}

  filterActive = false;
  applyFilterVisuals();
  document.getElementById("stats-bar").style.display = "none";
}}

function toggleCluster(clusterId, entityNames, groupEl) {{
  // Check if all entities in this cluster are already selected
  const allSelected = entityNames.every(n => selectedEntityNames.has(n));

  if (allSelected) {{
    // Deselect all
    entityNames.forEach(n => selectedEntityNames.delete(n));
    groupEl.classList.remove("selected");
    groupEl.querySelectorAll(".entity-chip").forEach(c => c.classList.remove("selected"));
  }} else {{
    // Select all
    entityNames.forEach(n => selectedEntityNames.add(n));
    groupEl.classList.add("selected");
    groupEl.querySelectorAll(".entity-chip").forEach(c => c.classList.add("selected"));
  }}

  if (selectedEntityNames.size > 0) {{
    runRetrieval();
  }} else {{
    filterActive = false;
    applyFilterVisuals();
    document.getElementById("stats-bar").style.display = "none";
    document.getElementById("scope-summary").style.display = "none";
    document.getElementById("reset-btn").style.display = "none";
  }}
}}

function updateClusterGroupState(groupEl, clusterEntityNames) {{
  const allSelected = clusterEntityNames.every(n => selectedEntityNames.has(n));
  if (allSelected) {{
    groupEl.classList.add("selected");
  }} else {{
    groupEl.classList.remove("selected");
  }}
}}

function toggleEntityChip(chip, name) {{
  if (selectedEntityNames.has(name)) {{
    selectedEntityNames.delete(name);
    chip.classList.remove("selected");
  }} else {{
    selectedEntityNames.add(name);
    chip.classList.add("selected");
  }}
  if (selectedEntityNames.size > 0) {{
    runRetrieval();
  }} else {{
    filterActive = false;
    applyFilterVisuals();
    document.getElementById("stats-bar").style.display = "none";
    document.getElementById("scope-summary").style.display = "none";
    document.getElementById("reset-btn").style.display = "none";
  }}
}}

function runRetrieval() {{
  // Union pre-computed scopes for all selected entities
  filterScopeNodeIds = new Set();
  selectedEntityNames.forEach(name => {{
    const scope = retrievalScopes[name] || [];
    scope.forEach(id => filterScopeNodeIds.add(id));
  }});

  filterActive = true;
  applyFilterVisuals();

  // Count node types in scope
  const scopeEntities = [...filterScopeNodeIds].filter(id => id.startsWith("entity-"));
  const scopeConcepts = [...filterScopeNodeIds].filter(id => id.startsWith("concept-"));
  const scopeParams = [...filterScopeNodeIds].filter(id => id.startsWith("param-"));
  const scopeCampaigns = [...filterScopeNodeIds].filter(id => id.startsWith("campaign-"));

  const statsBar = document.getElementById("stats-bar");
  statsBar.style.display = "flex";
  statsBar.innerHTML = `
    <div><div class="stat-value">${{scopeEntities.length}}</div><div class="stat-label">Entities</div></div>
    <div><div class="stat-value">${{scopeConcepts.length}}</div><div class="stat-label">Concepts</div></div>
    <div><div class="stat-value">${{scopeParams.length}}</div><div class="stat-label">Parameters</div></div>
    <div><div class="stat-value">${{scopeCampaigns.length}}</div><div class="stat-label">Campaigns</div></div>
  `;

  const summary = document.getElementById("scope-summary");
  summary.style.display = "block";
  summary.className = "scope-summary";
  summary.innerHTML = `
    <div><span class="scope-count">${{scopeEntities.length}}</span> entities</div>
    <div><span class="scope-count">${{scopeConcepts.length}}</span> concepts (operates_on)</div>
    <div><span class="scope-count">${{scopeParams.length}}</span> parameters (parent_concept)</div>
    <div><span class="scope-count">${{scopeCampaigns.length}}</span> campaigns</div>
  `;
  document.getElementById("reset-btn").style.display = "block";

  zoomToFitScope();
}}

function zoomToFitScope() {{
  // Compute bounding box of in-scope nodes
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;
  nodes.forEach(d => {{
    if (filterScopeNodeIds.has(d.id) && d.x != null && d.y != null) {{
      const r = nodeRadius(d);
      minX = Math.min(minX, d.x - r);
      minY = Math.min(minY, d.y - r);
      maxX = Math.max(maxX, d.x + r);
      maxY = Math.max(maxY, d.y + r);
      count++;
    }}
  }});
  if (count === 0) return;

  const padding = 60;
  const bw = maxX - minX + padding * 2;
  const bh = maxY - minY + padding * 2;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const scale = Math.min(1.2, 0.7 / Math.max(bw / width, bh / height));
  const translate = [width / 2 - scale * midX, height / 2 - scale * midY];

  svg.transition().duration(600).call(
    zoom.transform,
    d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
  );
}}

function applyFilterVisuals() {{
  if (!filterActive) {{
    // Show all nodes and links when no filter is active
    node.style("display", null);
    node.selectAll("circle, rect, polygon").attr("opacity", 1);
    node.selectAll("text").attr("opacity", 1);
    link.style("display", null);
    link.attr("stroke-opacity", 0.5);
    return;
  }}

  // Show only nodes in the retrieval scope
  node.each(function(d) {{
    const el = d3.select(this);
    if (filterScopeNodeIds.has(d.id)) {{
      el.style("display", null);
      el.selectAll("circle, rect, polygon").attr("opacity", 1);
      el.selectAll("text").attr("opacity", 1);
    }} else {{
      el.style("display", "none");
    }}
  }});

  // Show only edges where both endpoints are in scope
  link.each(function(d) {{
    const el = d3.select(this);
    const srcId = d.source.id || d.source;
    const tgtId = d.target.id || d.target;
    if (filterScopeNodeIds.has(srcId) && filterScopeNodeIds.has(tgtId)) {{
      el.style("display", null);
      el.attr("stroke-opacity", 0.7);
    }} else {{
      el.style("display", "none");
    }}
  }});
}}

function resetFilter() {{
  filterActive = false;
  filterScopeNodeIds.clear();
  selectedEntityNames.clear();
  applyFilterVisuals();

  // Reset UI
  document.getElementById("stats-bar").style.display = "none";
  document.getElementById("scope-summary").style.display = "none";
  document.getElementById("reset-btn").style.display = "none";
  document.getElementById("step2-num").classList.remove("done");
  document.querySelectorAll(".entity-chip").forEach(c => c.classList.remove("selected"));
  document.querySelectorAll(".cluster-group").forEach(g => g.classList.remove("selected"));
}}

// --- Markdown renderer ---
function renderMarkdown(md) {{
  if (!md) return "";
  // Remove the top-level H1 title (campaign name) — we already show it in the panel header
  let lines = md.split("\\n");
  if (lines[0] && lines[0].startsWith("# ")) lines = lines.slice(1);
  md = lines.join("\\n").trim();

  // Process block-level elements
  let html = "";
  const blocks = md.split(/\\n{{2,}}/);
  for (let block of blocks) {{
    block = block.trim();
    if (!block) continue;

    // H2 headings → styled section headers
    if (block.startsWith("## ")) {{
      const title = block.replace(/^## /, "");
      html += `<div class="md-section-title">${{inlineFormat(title)}}</div>`;
      continue;
    }}

    // Bullet lists
    if (/^[-*] /.test(block)) {{
      const items = block.split(/\\n/).filter(l => l.trim());
      html += `<ul class="md-list">`;
      items.forEach(item => {{
        const text = item.replace(/^[-*] /, "");
        html += `<li>${{inlineFormat(text)}}</li>`;
      }});
      html += `</ul>`;
      continue;
    }}

    // Key-value lines (like **Date:** value)
    if (/^[*][*][^*]+:[*][*]/.test(block)) {{
      const kvLines = block.split("\\n").filter(l => l.trim());
      kvLines.forEach(line => {{
        html += `<div class="md-kv">${{inlineFormat(line)}}</div>`;
      }});
      continue;
    }}

    // Regular paragraph
    html += `<p class="md-para">${{inlineFormat(block.replace(/\\n/g, " "))}}</p>`;
  }}
  return html;
}}

function inlineFormat(text) {{
  // Bold: **text**
  text = text.replace(/[*][*]([^*]+)[*][*]/g, '<strong>$1</strong>');
  // Italic: *text*
  text = text.replace(/[*]([^*]+)[*]/g, '<em>$1</em>');
  // Inline code: `text`
  text = text.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:3px;font-size:11px;">$1</code>');
  // RP-N references highlighted
  text = text.replace(/\\b(RP-\\d+)\\b/g, '<span style="color:#7986cb;font-weight:600;">$1</span>');
  return text;
}}

// --- D3 visualization ---
const width = window.innerWidth;
const height = window.innerHeight;

const svg = d3.select("#graph")
  .attr("width", width)
  .attr("height", height);


// Zoom behavior
const g = svg.append("g");
const zoom = d3.zoom()
  .scaleExtent([0.2, 4])
  .on("zoom", (event) => g.attr("transform", event.transform));
svg.call(zoom);

// Color and size scales (synced with visualize_campaign.py)
const typeColors = {{
  campaign: "#78909c",
  concept: "#5c6bc0",
  parameter: "#ce93d8",
  entity: "#66bb6a",
}};

function nodeRadius(d) {{
  if (d.type === "campaign") return 22;
  if (d.type === "entity") return 8 + (d.campaignCount || 1) * 4;
  if (d.type === "concept") return 7;
  if (d.type === "parameter") return 5;
  return 6;
}}

// Entity box dimensions (width x height) based on campaignCount
function nodeColor(d) {{
  return typeColors[d.type] || "#999";
}}

function linkColor(d) {{
  if (d.edgeType === "entity") return "#66bb6a";
  if (d.edgeType === "concept") return "#5c6bc0";
  if (d.edgeType === "operates_on") return "#80cbc4";
  if (d.edgeType === "has_param") return "#ce93d8";
  if (d.edgeType === "interacts") return "#90a4ae";
  if (d.edgeType === "shared_principles") return "#ffab40";
  if (d.edgeType === "related") return "#616161";
  return "#555";
}}

function linkDash(d) {{
  if (d.edgeType === "entity") return "4,3";
  if (d.edgeType === "operates_on") return "2,2";
  if (d.edgeType === "has_param") return "3,2";
  if (d.edgeType === "interacts") return "4,2";
  if (d.edgeType === "shared_principles") return "6,2";
  if (d.edgeType === "related") return "2,3";
  return "none";
}}

function linkWidth(d) {{
  if (d.edgeType === "entity") return 1.5;
  if (d.edgeType === "concept") return 1.2;
  if (d.edgeType === "operates_on") return 1.2;
  if (d.edgeType === "has_param") return 0.8;
  if (d.edgeType === "interacts") return 1.5;
  if (d.edgeType === "shared_principles") return Math.min(0.8 + (d.strength || 1) * 0.4, 3);
  if (d.edgeType === "related") return 0.6;
  return 1;
}}

// Force simulation
const simulation = d3.forceSimulation(nodes)
  .force("link", d3.forceLink(links).id(d => d.id).distance(d => {{
    if (d.edgeType === "entity") return 120;
    if (d.edgeType === "concept") return 70;
    if (d.edgeType === "operates_on") return 60;
    if (d.edgeType === "has_param") return 40;
    if (d.edgeType === "interacts") return 80;
    if (d.edgeType === "shared_principles") return 100;
    if (d.edgeType === "related") return 70;
    return 55;
  }}).strength(d => {{
    if (d.edgeType === "entity") return 0.3;
    if (d.edgeType === "operates_on") return 0.4;
    if (d.edgeType === "has_param") return 0.5;
    if (d.edgeType === "interacts") return 0.2;
    if (d.edgeType === "shared_principles") return 0.15;
    if (d.edgeType === "related") return 0.15;
    return 0.5;
  }}))
  .force("charge", d3.forceManyBody().strength(d => {{
    if (d.type === "campaign") return -400;
    if (d.type === "entity") return -100;
    return -40;
  }}))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collision", d3.forceCollide().radius(d => nodeRadius(d) + 4))
  .force("x", d3.forceX(d => {{
    // Position campaigns in a timeline row
    if (d.type === "campaign" && d.totalCampaigns > 1) {{
      const padding = 200;
      const span = width - padding * 2;
      return padding + (d.timeIndex / (d.totalCampaigns - 1)) * span;
    }}
    // Position entities by cluster (spread across X axis)
    if (d.type === "entity") {{
      const clusterIdx = entityClusterMap[d.id];
      if (clusterIdx != null) {{
        const numClusters = entityClusters.length;
        const padding = 150;
        const span = width - padding * 2;
        return padding + (clusterIdx / Math.max(numClusters - 1, 1)) * span;
      }}
    }}
    return width / 2;
  }}).strength(d => {{
    if (d.type === "campaign") return 0.3;
    if (d.type === "entity") return 0.08;
    return 0.02;
  }}))
  .force("y", d3.forceY(d => {{
    if (d.type === "campaign") return height * 0.35;
    if (d.type === "entity") return height * 0.2;
    if (d.type === "concept" || d.type === "parameter") return height * 0.55;
    return height * 0.55;
  }}).strength(d => {{
    if (d.type === "campaign") return 0.2;
    if (d.type === "entity" && d.campaignCount > 1) return 0.1;
    return 0.03;
  }}));

// Draw links
const link = g.append("g")
  .selectAll("line")
  .data(links)
  .join("line")
  .attr("class", "link")
  .attr("stroke", linkColor)
  .attr("stroke-dasharray", linkDash)
  .attr("stroke-width", linkWidth);

// Draw nodes
const node = g.append("g")
  .selectAll("g")
  .data(nodes)
  .join("g")
  .attr("class", "node")
  .call(d3.drag()
    .on("start", dragstarted)
    .on("drag", dragged)
    .on("end", dragended));

// Node shapes by type (synced with visualize_campaign.py):
// Campaigns → circles (grey, with border)
node.filter(d => d.type === "campaign")
  .append("circle")
  .attr("r", nodeRadius)
  .attr("fill", nodeColor)
  .attr("stroke", "#b0bec5")
  .attr("stroke-width", 2.5);

// Concepts → rounded squares (indigo fill, blue stroke)
node.filter(d => d.type === "concept")
  .append("rect")
  .attr("width", d => nodeRadius(d) * 2)
  .attr("height", d => nodeRadius(d) * 2)
  .attr("x", d => -nodeRadius(d))
  .attr("y", d => -nodeRadius(d))
  .attr("rx", 4).attr("ry", 4)
  .attr("fill", "#1a237e")
  .attr("stroke", "#5c6bc0")
  .attr("stroke-width", 2);

// Parameters → triangles (purple fill, pink stroke)
node.filter(d => d.type === "parameter")
  .append("polygon")
  .attr("points", d => {{
    const r = nodeRadius(d);
    return `0,-${{r}} ${{r}},${{r * 0.75}} -${{r}},${{r * 0.75}}`;
  }})
  .attr("fill", "#4a148c")
  .attr("stroke", "#ce93d8")
  .attr("stroke-width", 1.5);

// Entities → diamonds (cluster-colored fill and stroke)
node.filter(d => d.type === "entity")
  .append("polygon")
  .attr("points", d => {{
    const r = nodeRadius(d) * 1.2;
    return `-${{r}},0 0,-${{r}} ${{r}},0 0,${{r}}`;
  }})
  .attr("fill", d => entityClusterFill(d.id))
  .attr("stroke", d => entityClusterColor(d.id))
  .attr("stroke-width", d => d.campaignCount > 1 ? 2.5 : 1.5);


// Labels (only for campaigns and multi-campaign entities)
node.filter(d => d.type === "campaign" || (d.type === "entity" && d.campaignCount > 1))
  .append("text")
  .attr("class", d => `label ${{d.type === "campaign" ? "label-campaign" : ""}}`)
  .attr("dy", d => {{
    if (d.type === "entity") return nodeRadius(d) * 1.2 + 14;
    return nodeRadius(d) + 14;
  }})
  .text(d => {{
    if (d.type === "campaign") {{
      const name = d.label || "";
      return name.length > 25 ? name.substring(0, 22) + "..." : name;
    }}
    return d.label;
  }});

// Cost badges on campaign nodes
node.filter(d => d.type === "campaign" && campaignCosts[d.label])
  .append("text")
  .attr("class", "cost-badge")
  .attr("dy", d => -(nodeRadius(d) + 6))
  .text(d => `$${{campaignCosts[d.label].toFixed(0)}}`);

// Show all nodes by default — filter hides them only when user selects a scope
node.style("display", null);
link.style("display", null);

// Tooltip
const tooltip = d3.select("#tooltip");

node.on("mouseover", (event, d) => {{
  const typeLabels = {{ campaign: "Campaign", entity: "Entity", concept: "Concept", parameter: "Parameter" }};
  let html = `<div class="tt-type">${{typeLabels[d.type] || d.type}}</div>`;
  html += `<h3>${{d.label}}</h3>`;

  if (d.type === "campaign") {{
    html += `<div class="tt-field"><div class="tt-label">Date</div><div class="tt-value">${{d.date || "unknown"}}</div></div>`;
    html += `<div class="tt-field"><div class="tt-label">Research Question</div><div class="tt-value">${{d.research_question || ""}}</div></div>`;
    html += `<div class="tt-field"><div class="tt-label">Scope</div><div class="tt-value">${{d.conceptCount}} concepts, ${{d.paramCount}} params</div></div>`;
    if (campaignCosts[d.label]) {{
      html += `<div class="tt-field"><div class="tt-label">LLM Cost</div><div class="tt-value" style="color:#ffab40;">$${{campaignCosts[d.label].toFixed(2)}}</div></div>`;
    }}
  }} else if (d.type === "entity") {{
    html += `<div class="tt-field"><div class="tt-label">Campaigns</div><div class="tt-value">${{(d.campaigns || []).join(", ")}}</div></div>`;
  }} else {{
    html += `<div class="tt-field"><div class="tt-label">Campaign</div><div class="tt-value">${{d.campaign || ""}}</div></div>`;
  }}

  tooltip.html(html).style("display", "block");
  // Highlight connected edges
  link.attr("stroke-opacity", l =>
    (l.source.id === d.id || l.target.id === d.id) ? 1 : 0.15
  );
  node.each(function(n) {{
    const opac = (n.id === d.id || links.some(l =>
      (l.source.id === d.id && l.target.id === n.id) ||
      (l.target.id === d.id && l.source.id === n.id)
    )) ? 1 : 0.3;
    d3.select(this).selectAll("circle, rect, polygon").attr("opacity", opac);
  }});
}})
.on("mousemove", (event) => {{
  tooltip.style("left", (event.pageX + 12) + "px")
    .style("top", (event.pageY - 10) + "px");
}})
.on("mouseout", () => {{
  tooltip.style("display", "none");
  applyFilterVisuals();
}})
.on("click", (event, d) => {{
  event.stopPropagation();
  if (d.type === "campaign") {{
    window.open(d.label + ".html", "_blank");
  }} else {{
    showDetailPanel(d);
  }}
}});

svg.on("click", () => closePanel());

// Detail panel
function showDetailPanel(d) {{
  const panel = document.getElementById("detail-panel");
  const content = document.getElementById("panel-content");
  let html = "";

  if (d.type === "campaign") {{
    html += `<h2>${{d.label}}</h2>`;
    html += `<div class="panel-type">Campaign &mdash; <span class="campaign-date">${{d.date || ""}}</span></div>`;
    html += `<p style="color:#ccc;font-style:italic;line-height:1.5;">${{d.research_question || ""}}</p>`;
    if (campaignCosts[d.label]) {{
      html += `<div style="margin:8px 0;padding:8px 12px;background:rgba(255,171,64,0.1);border-radius:6px;border-left:3px solid #ffab40;">`;
      html += `<span style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">Total LLM Cost</span>`;
      html += `<div style="color:#ffab40;font-size:18px;font-weight:700;margin-top:4px;">$${{campaignCosts[d.label].toFixed(2)}}</div>`;
      html += `</div>`;
    }}

    // Show summary from campaignDetails (rendered as HTML)
    const details = campaignDetails[d.label];
    if (details && details.summary) {{
      html += `<div class="panel-section panel-summary">${{renderMarkdown(details.summary)}}</div>`;
    }}

    // Connected entities
    const connEnts = links.filter(l => l.source.id === d.id && l.edgeType === "entity")
      .map(l => nodeIndex[l.target.id] || nodeIndex[l.target]);
    if (connEnts.length > 0) {{
      html += `<div class="panel-section"><div class="panel-section-title">Entities Studied</div>`;
      connEnts.forEach(e => {{
        html += `<div class="panel-item">${{e.label}}</div>`;
      }});
      html += `</div>`;
    }}

    // Connected concepts
    const connConcepts = links.filter(l => l.source.id === d.id && l.edgeType === "concept")
      .map(l => nodeIndex[l.target.id] || nodeIndex[l.target])
      .filter(Boolean);
    if (connConcepts.length > 0) {{
      html += `<div class="panel-section"><div class="panel-section-title">Concepts Discovered</div>`;
      connConcepts.forEach(c => {{
        html += `<div class="panel-item">${{c.label}}</div>`;
      }});
      html += `</div>`;
    }}

    // Dead-ends (from campaignDetails, not graph nodes)
    const details_de = campaignDetails[d.label];
    if (details_de && details_de.dead_ends && details_de.dead_ends.length > 0) {{
      html += `<div class="panel-section"><div class="panel-section-title" style="color:#f44336;">Dead-ends (avoid)</div>`;
      details_de.dead_ends.forEach(de => {{
        html += `<div class="panel-item" style="border-left:3px solid #f44336;padding-left:8px;">${{de.title}}</div>`;
      }});
      html += `</div>`;
    }}

    // Frontiers (from campaignDetails, not graph nodes)
    if (details_de && details_de.frontiers && details_de.frontiers.length > 0) {{
      html += `<div class="panel-section"><div class="panel-section-title" style="color:#ff9800;">Frontiers (opportunities)</div>`;
      details_de.frontiers.forEach(fr => {{
        html += `<div class="panel-item" style="border-left:3px solid #ff9800;padding-left:8px;">${{fr.title}}</div>`;
      }});
      html += `</div>`;
    }}

  }} else if (d.type === "entity") {{
    html += `<h2>${{d.label}}</h2>`;
    html += `<div class="panel-type">Entity &mdash; Pre-existing infrastructure</div>`;
    html += `<p style="color:#aaa;">Studied in ${{d.campaignCount}} campaign${{d.campaignCount > 1 ? "s" : ""}}:</p>`;
    (d.campaigns || []).forEach(cName => {{
      html += `<div class="panel-item" style="cursor:pointer;" onclick="focusCampaign('${{cName}}')">${{cName}}</div>`;
    }});

    // Show definition if available from details
    for (const [campName, details] of Object.entries(campaignDetails)) {{
      if (details.entities) {{
        const ent = details.entities.find(e => e.name === d.label);
        if (ent) {{
          html += `<div class="panel-section"><div class="panel-section-title">Definition (from ${{campName}})</div>`;
          html += `<div style="color:#ccc;line-height:1.5;">${{ent.definition || ""}}</div></div>`;
          break;
        }}
      }}
    }}

  }} else if (d.type === "concept") {{
    html += `<h2>${{d.label}}</h2>`;
    html += `<div class="panel-type" style="color:#66bb6a">Concept &mdash; ${{d.campaign}}</div>`;

    const details = campaignDetails[d.campaign];
    if (details && details.concepts) {{
      const concept = details.concepts.find(c => c.name === d.label);
      if (concept) {{
        html += `<div class="panel-section"><div class="panel-section-title">Definition</div><div style="color:#ccc;line-height:1.5;">${{concept.definition || ""}}</div></div>`;
      }}
    }}

  }} else if (d.type === "parameter") {{
    html += `<h2>${{d.label}}</h2>`;
    html += `<div class="panel-type">Parameter &mdash; ${{d.campaign}}</div>`;

    const details = campaignDetails[d.campaign];
    if (details && details.parameters) {{
      const param = details.parameters.find(p => p.name === d.label);
      if (param) {{
        html += `<div class="panel-section"><div class="panel-section-title">Definition</div><div style="color:#ccc;line-height:1.5;">${{param.definition || ""}}</div></div>`;
        if (param.evolution && param.evolution.length > 0) {{
          html += `<div class="panel-section"><div class="panel-section-title">Evolution</div>`;
          const outcomeColors = {{ "confirmed": "#4caf50", "refuted": "#f44336", "partially_confirmed": "#ff9800", "baseline": "#9e9e9e" }};
          param.evolution.forEach(ev => {{
            const oc = outcomeColors[(ev.outcome || "").toLowerCase()] || "#9e9e9e";
            html += `<div style="margin:6px 0;border-left:3px solid ${{oc}};padding-left:8px;">`;
            html += `<span style="color:#ccc;font-weight:600;">${{ev.iter}}</span> `;
            html += `<span style="color:#7986cb;">= ${{ev.value}}</span><br>`;
            html += `<span style="color:#999;font-size:10px;">${{ev.note || ""}}</span></div>`;
          }});
          html += `</div>`;
        }}
      }}
    }}
  }}

  content.innerHTML = html;
  panel.classList.add("visible");
}}

function closePanel() {{
  document.getElementById("detail-panel").classList.remove("visible");
}}

function focusCampaign(name) {{
  const cNode = nodes.find(n => n.type === "campaign" && n.label === name);
  if (cNode) showDetailPanel(cNode);
}}

// Drag behavior
function dragstarted(event, d) {{
  if (!event.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x; d.fy = d.y;
}}
function dragged(event, d) {{
  d.fx = event.x; d.fy = event.y;
}}
function dragended(event, d) {{
  if (!event.active) simulation.alphaTarget(0);
  d.fx = null; d.fy = null;
}}

// Tick
simulation.on("tick", () => {{
  link
    .attr("x1", d => d.source.x)
    .attr("y1", d => d.source.y)
    .attr("x2", d => d.target.x)
    .attr("y2", d => d.target.y);
  node.attr("transform", d => `translate(${{d.x}},${{d.y}})`);
}});

// Initial zoom to fit
setTimeout(() => {{
  const bounds = g.node().getBBox();
  const fullWidth = bounds.width;
  const fullHeight = bounds.height;
  const midX = bounds.x + fullWidth / 2;
  const midY = bounds.y + fullHeight / 2;
  const scale = Math.min(0.85, 0.85 / Math.max(fullWidth / width, fullHeight / height));
  const translate = [width / 2 - scale * midX, height / 2 - scale * midY];
  svg.transition().duration(750).call(
    zoom.transform,
    d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
  );
}}, 2000);

// Legend toggle
function toggleLegend() {{
  const panel = document.getElementById("legend-panel");
  const arrow = document.getElementById("legend-arrow");
  panel.classList.toggle("collapsed");
  arrow.innerHTML = panel.classList.contains("collapsed") ? "&#9656;" : "&#9662;";
}}

// --- Opportunities View (Heuristic-scored, no LLM calls) ---
let currentView = "knowledge";

let oppClusterFilter = null;  // null = show all

function setOppClusterFilter(clusterId) {{
  oppClusterFilter = (oppClusterFilter === clusterId) ? null : clusterId;
  renderOpportunities();
}}

// Compute heuristic opportunity score for a cluster from registry data.
// Only counts frontiers/interactions whose related_principles overlap with
// the principles of entities in the cluster (principle-based relevance).
function computeClusterScore(cluster) {{
  const clusterEntities = new Set(cluster.entities);
  let frontierCount = 0;
  let interactionCount = 0;
  let deadEndCount = 0;
  let campaignCount = 0;
  let latestDate = "";
  const relatedCampaigns = [];
  const frontierTitles = [];
  const interactionTitles = [];
  const deadEndTitles = [];

  Object.values(registryData.projects || {{}}).forEach(project => {{
    project.campaigns.forEach(campaign => {{
      const details = campaignDetails[campaign.name] || {{}};
      const campaignEntities = details.entities || [];
      const touches = campaignEntities.some(e => clusterEntities.has(e.name));
      if (!touches) return;

      // Build the set of principles linked to entities in THIS cluster
      const clusterPrinciples = new Set();
      campaignEntities.forEach(e => {{
        if (clusterEntities.has(e.name)) {{
          (e.principles || []).forEach(p => clusterPrinciples.add(p));
        }}
      }});

      campaignCount++;
      relatedCampaigns.push(campaign.name);
      if (campaign.date > latestDate) latestDate = campaign.date;

      // Count frontiers — only if related_principles overlap with cluster
      (details.frontiers || []).forEach(f => {{
        const related = f.related_principles || [];
        if (related.some(p => clusterPrinciples.has(p))) {{
          frontierCount++;
          frontierTitles.push(`${{f.id || "?"}}: ${{f.title || ""}}`);
        }}
      }});
      // Count interactions — only if related_principles overlap with cluster
      (details.interactions || []).forEach(i => {{
        const related = i.related_principles || [];
        if (related.some(p => clusterPrinciples.has(p))) {{
          interactionCount++;
          interactionTitles.push(`${{i.id || "?"}}: ${{i.title || ""}}`);
        }}
      }});
      // Dead-ends lack related_principles — count all from touching campaigns
      // (conservative: over-counting dead-ends penalizes the score)
      (details.dead_ends || []).forEach(d => {{
        deadEndCount++;
        deadEndTitles.push(`${{d.id || "?"}}: ${{d.title || ""}}`);
      }});
    }});
  }});

  // Raw score: more frontiers + interactions = more opportunity
  // Dead-ends reduce score slightly (territory is more constrained)
  const rawScore = (frontierCount * 2) + (interactionCount * 3) - (deadEndCount * 0.5);

  return {{
    rawScore,
    frontierCount,
    interactionCount,
    deadEndCount,
    campaignCount,
    latestDate,
    relatedCampaigns,
    frontierTitles: frontierTitles.slice(0, 5),
    interactionTitles: interactionTitles.slice(0, 5),
    deadEndTitles: deadEndTitles.slice(0, 5),
  }};
}}

// Copy text to clipboard
function copyToClipboard(text, btn) {{
  navigator.clipboard.writeText(text).then(() => {{
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => {{ btn.textContent = orig; }}, 1500);
  }});
}}

function renderOpportunities() {{
  const container = document.getElementById("opp-list-container");

  if (!entityClusters || entityClusters.length === 0) {{
    container.innerHTML = `<div style="color:#888;text-align:center;padding:60px;font-size:13px;">No entity clusters found.<br>Run <code>/index-wiki</code> on at least two campaigns to generate clusters.</div>`;
    return;
  }}

  // Compute raw scores for all clusters, then normalize adaptively
  const rawScored = entityClusters.map(cluster => ({{
    ...cluster,
    ...computeClusterScore(cluster),
  }}));
  const maxRaw = Math.max(...rawScored.map(c => c.rawScore), 1);
  const scored = rawScored.map(c => ({{
    ...c,
    score: Math.max(0, c.rawScore / maxRaw),
  }}));
  scored.sort((a, b) => b.score - a.score);
  scored.splice(20); // Cap at 20 clusters

  // Filter
  const filtered = oppClusterFilter == null
    ? scored
    : scored.filter(c => c.id === oppClusterFilter);

  // Cluster filter bar
  let html = `<div class="opp-cluster-bar">`;
  html += `<span class="opp-cluster-bar-label">Filter by entity cluster:</span>`;
  scored.forEach(cluster => {{
    const color = clusterColors[cluster.id % clusterColors.length];
    const active = oppClusterFilter === cluster.id ? "active" : "";
    html += `<button class="opp-cluster-btn ${{active}}" style="--btn-color:${{color}}" onclick="setOppClusterFilter(${{cluster.id}})">`;
    html += `<span class="cluster-dot-inline" style="background:${{color}}"></span>${{cluster.label}}`;
    html += `</button>`;
  }});
  const allActive = oppClusterFilter == null ? "active" : "";
  html += `<button class="opp-cluster-btn ${{allActive}}" style="--btn-color:#78909c" onclick="setOppClusterFilter(null)">All</button>`;
  html += `</div>`;

  // Explainer banner
  html += `<div style="background:rgba(121,134,203,0.08);border:1px solid rgba(121,134,203,0.25);border-radius:6px;padding:12px 16px;margin-bottom:16px;font-size:11px;color:#aaa;line-height:1.6;">`;
  html += `<strong style="color:#b39ddb;">Research landscape</strong> — entity clusters ranked by open research territory. `;
  html += `<span style="color:#ff9800;">Frontiers</span> and <span style="color:#26c6da;">interactions</span> are matched via principle overlap with the cluster's entities.<br>`;
  html += `To get detailed recommendations, run: `;
  html += `<code style="background:#0a1628;padding:4px 8px;border-radius:3px;color:#7986cb;display:inline-block;margin-top:4px;">/suggest-next &lt;project&gt; "your research question"</code>`;
  html += `</div>`;

  // Header
  html += `<div class="opp-header">`;
  html += `<span>${{filtered.length}} entity clusters</span>`;
  html += `</div>`;

  // Render cluster cards
  filtered.forEach(cluster => {{
    const color = clusterColors[cluster.id % clusterColors.length];

    html += `<div class="opp-card" onclick="this.classList.toggle('expanded')">`;

    // Header: label
    html += `<div class="opp-card-header">`;
    html += `<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${{color}};margin-right:4px;"></span>`;
    html += `<span class="opp-card-title">${{cluster.label}}</span>`;
    html += `</div>`;

    // Summary metrics
    html += `<div class="opp-card-meta" style="margin-top:6px;">`;
    html += `<span style="color:#ff9800;">${{cluster.frontierCount}} frontiers</span>`;
    html += `<span style="color:#26c6da;">${{cluster.interactionCount}} interactions</span>`;
    html += `<span style="color:#f44336;">${{cluster.deadEndCount}} dead-ends</span>`;
    html += `<span>${{cluster.campaignCount}} campaigns</span>`;
    if (cluster.latestDate) html += `<span style="color:#666;">Last: ${{cluster.latestDate}}</span>`;
    html += `</div>`;

    // Entities
    html += `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;">`;
    cluster.entities.forEach(name => {{
      html += `<span style="font-size:10px;background:rgba(255,255,255,0.05);border:1px solid #0f3460;padding:2px 8px;border-radius:3px;color:#ccc;">${{name}}</span>`;
    }});
    html += `</div>`;

    // Expandable detail
    html += `<div class="opp-card-detail">`;

    // Frontiers
    if (cluster.frontierTitles.length > 0) {{
      html += `<div class="detail-section"><div class="detail-label" style="color:#ff9800;">Open Frontiers</div>`;
      cluster.frontierTitles.forEach(f => {{
        html += `<div style="margin:4px 0;color:#ccc;font-size:11px;border-left:2px solid #ff9800;padding-left:8px;">${{f}}</div>`;
      }});
      if (cluster.frontierCount > 5) html += `<div style="color:#666;font-size:10px;margin-top:4px;">...and ${{cluster.frontierCount - 5}} more</div>`;
      html += `</div>`;
    }}

    // Interactions
    if (cluster.interactionTitles.length > 0) {{
      html += `<div class="detail-section"><div class="detail-label" style="color:#26c6da;">Untested Interactions</div>`;
      cluster.interactionTitles.forEach(i => {{
        html += `<div style="margin:4px 0;color:#ccc;font-size:11px;border-left:2px solid #26c6da;padding-left:8px;">${{i}}</div>`;
      }});
      if (cluster.interactionCount > 5) html += `<div style="color:#666;font-size:10px;margin-top:4px;">...and ${{cluster.interactionCount - 5}} more</div>`;
      html += `</div>`;
    }}

    // Dead-ends
    if (cluster.deadEndTitles.length > 0) {{
      html += `<div class="detail-section"><div class="detail-label" style="color:#f44336;">Known Dead-Ends</div>`;
      cluster.deadEndTitles.forEach(d => {{
        html += `<div style="margin:4px 0;color:#999;font-size:11px;border-left:2px solid #f44336;padding-left:8px;">${{d}}</div>`;
      }});
      if (cluster.deadEndCount > 5) html += `<div style="color:#666;font-size:10px;margin-top:4px;">...and ${{cluster.deadEndCount - 5}} more</div>`;
      html += `</div>`;
    }}

    // Suggest-next command
    const entityList = cluster.entities.map(e => `"${{e}}"`).join(" ");
    const repoPath = Object.keys(registryData.projects || {{}})[0] || "<repo-path>";
    const suggestCmd = `/suggest-next ${{repoPath}} "explore ${{cluster.label.toLowerCase()}} opportunities"`;

    html += `<div class="detail-section" style="padding-top:14px;">`;
    html += `<div class="detail-label">Get detailed recommendations</div>`;
    html += `<div style="background:#0a1628;border:1px solid #1a2a4a;border-radius:5px;padding:10px 12px;margin-top:6px;font-family:'SF Mono','Fira Code',monospace;font-size:11px;color:#7986cb;word-break:break-all;">`;
    html += suggestCmd;
    html += `</div>`;
    html += `<button onclick="event.stopPropagation(); copyToClipboard('${{suggestCmd.replace(/'/g, "\\\\'")}}', this)" style="margin-top:8px;background:#1a2a4a;border:1px solid #0f3460;color:#aaa;padding:6px 12px;border-radius:4px;font-size:10px;cursor:pointer;transition:all 0.2s;">`;
    html += `Copy command</button>`;
    html += `<span style="color:#555;font-size:10px;margin-left:8px;">Runs /suggest-next scoped to this cluster's entities</span>`;
    html += `</div>`;

    html += `</div>`; // end detail
    html += `</div>`; // end card
  }});

  container.innerHTML = html;
}}


// --- View switching ---
function switchView(view) {{
  if (view === currentView) return;
  currentView = view;

  document.querySelectorAll(".view-btn").forEach(b => b.classList.remove("active"));
  document.getElementById(`btn-${{view}}`).classList.add("active");

  const oppContainer = document.getElementById("opp-list-container");
  const graphEl = document.getElementById("graph");

  if (view === "knowledge") {{
    // Show knowledge graph, hide opportunities list
    oppContainer.style.display = "none";
    graphEl.style.display = "block";
    g.style("display", null);
    svg.call(zoom.on("zoom", (event) => g.attr("transform", event.transform)));
    applyFilterVisuals();
    document.getElementById("filter-panel").style.display = "block";
    document.getElementById("legend-panel").style.display = "block";
    if (filterActive) document.getElementById("stats-bar").style.display = "flex";
  }} else if (view === "opportunities") {{
    // Hide knowledge graph, show pre-computed opportunities
    graphEl.style.display = "none";
    oppContainer.style.display = "block";
    document.getElementById("filter-panel").style.display = "none";
    document.getElementById("legend-panel").style.display = "none";
    document.getElementById("stats-bar").style.display = "none";
    closePanel();
    renderOpportunities();
  }}
}}
</script>
</body>
</html>"""


def load_registry(wiki_dir: Path) -> dict:
    """Load the cross-campaign registry."""
    registry_path = wiki_dir / "registry.json"
    if not registry_path.exists():
        print(f"Error: registry.json not found at {registry_path}", file=sys.stderr)
        print("Run /post-campaign and /index-wiki first to build the registry.", file=sys.stderr)
        sys.exit(1)

    try:
        with open(registry_path) as f:
            return json.load(f)
    except (json.JSONDecodeError, ValueError) as e:
        print(f"Error: registry.json is corrupted: {e}", file=sys.stderr)
        print(f"Path: {registry_path}", file=sys.stderr)
        print("Try re-running /index-wiki to rebuild the registry.", file=sys.stderr)
        sys.exit(1)


def load_campaign_details(wiki_dir: Path, registry: dict) -> dict:
    """Load per-campaign detail files (concepts, dead-ends, frontiers, summaries).

    Returns a dict keyed by campaign name with detail data for the panel.
    """
    details = {}

    for repo_path, project in registry.get("projects", {}).items():
        for campaign in project.get("campaigns", []):
            name = campaign["name"]
            campaign_dir = wiki_dir / "campaigns" / name
            entry = {}

            # Load summary.md
            summary_path = campaign_dir / "summary.md"
            if summary_path.exists():
                entry["summary"] = summary_path.read_text()

            # Load concepts.json for definitions
            concepts_path = campaign_dir / "concepts.json"
            if concepts_path.exists():
                try:
                    with open(concepts_path) as f:
                        concepts_data = json.load(f)
                    entry["concepts"] = concepts_data.get("concepts", [])
                    entry["parameters"] = concepts_data.get("parameters", [])
                    entry["entities"] = concepts_data.get("entities", [])
                except (json.JSONDecodeError, ValueError) as e:
                    print(f"Warning: skipping corrupted {concepts_path}: {e}", file=sys.stderr)

            # Load dead-ends.json
            dead_ends_path = campaign_dir / "dead-ends.json"
            if dead_ends_path.exists():
                try:
                    with open(dead_ends_path) as f:
                        entry["dead_ends"] = json.load(f)
                except (json.JSONDecodeError, ValueError) as e:
                    print(f"Warning: skipping corrupted {dead_ends_path}: {e}", file=sys.stderr)

            # Load frontiers.json
            frontiers_path = campaign_dir / "frontiers.json"
            if frontiers_path.exists():
                try:
                    with open(frontiers_path) as f:
                        entry["frontiers"] = json.load(f)
                except (json.JSONDecodeError, ValueError) as e:
                    print(f"Warning: skipping corrupted {frontiers_path}: {e}", file=sys.stderr)

            # Load interactions.json
            interactions_path = campaign_dir / "interactions.json"
            if interactions_path.exists():
                try:
                    with open(interactions_path) as f:
                        entry["interactions"] = json.load(f)
                except (json.JSONDecodeError, ValueError) as e:
                    print(f"Warning: skipping corrupted {interactions_path}: {e}", file=sys.stderr)

            details[name] = entry

    return details


def build_cross_edges(registry: dict, campaign_details: dict) -> list:
    """Build cross-node edges directly from explicit relationship fields.

    Reads operates_on/parameters from concepts.json data and translates
    to registry-level node IDs.

    Returns a list of edge dicts: {source, target, edgeType, strength}
    """
    edges = []
    seen = set()

    for repo_path, project in registry.get("projects", {}).items():
        # Build name→registry_node_id maps for this project
        concept_name_to_id = {}
        param_name_to_id = {}
        entity_name_to_id = {}

        for campaign in project.get("campaigns", []):
            camp_name = campaign["name"]
            for c in campaign.get("concepts", []):
                concept_name_to_id[(camp_name, c["name"])] = f"concept-{c['id']}"
            for p in campaign.get("parameters", []):
                param_name_to_id[(camp_name, p["name"])] = f"param-{p['id']}"

        for e in project.get("entities", []):
            entity_name_to_id[e["name"]] = f"entity-{e['id']}"

        # For each campaign, read explicit relationships directly
        for campaign in project.get("campaigns", []):
            camp_name = campaign["name"]
            details = campaign_details.get(camp_name, {})

            for concept in details.get("concepts", []):
                concept_id = concept_name_to_id.get((camp_name, concept["name"]))
                if not concept_id:
                    continue

                # Concept → Entity (operates_on)
                for entity_name in concept.get("operates_on", []):
                    entity_id = entity_name_to_id.get(entity_name)
                    if not entity_id:
                        continue
                    pair_key = tuple(sorted([concept_id, entity_id]))
                    if pair_key in seen:
                        continue
                    seen.add(pair_key)
                    edges.append({
                        "source": concept_id,
                        "target": entity_id,
                        "edgeType": "operates_on",
                        "strength": 1,
                    })

            # Parameter → parent concept (has_param) — derived from parameter side
            # to guarantee single ownership (parent_concept is a string, not array)
            for param in details.get("parameters", []):
                parent_name = param.get("parent_concept")
                if not parent_name:
                    continue
                concept_id = concept_name_to_id.get((camp_name, parent_name))
                param_id = param_name_to_id.get((camp_name, param["name"]))
                if not concept_id or not param_id:
                    continue
                pair_key = tuple(sorted([concept_id, param_id]))
                if pair_key in seen:
                    continue
                seen.add(pair_key)
                edges.append({
                    "source": concept_id,
                    "target": param_id,
                    "edgeType": "has_param",
                    "strength": 1,
                })

            # Entity↔Entity edges: principle overlap (≥2 shared)
            entity_nodes = [
                (entity_name_to_id[e["name"]], set(e.get("principles", [])))
                for e in details.get("entities", [])
                if e["name"] in entity_name_to_id
            ]
            for i in range(len(entity_nodes)):
                for j in range(i + 1, len(entity_nodes)):
                    shared = entity_nodes[i][1] & entity_nodes[j][1]
                    if len(shared) >= 2:
                        pair_key = tuple(sorted([entity_nodes[i][0], entity_nodes[j][0]]))
                        if pair_key in seen:
                            continue
                        seen.add(pair_key)
                        edges.append({
                            "source": entity_nodes[i][0],
                            "target": entity_nodes[j][0],
                            "edgeType": "interacts",
                            "strength": len(shared),
                        })

        # Cross-campaign concept↔concept edges: concepts from DIFFERENT campaigns
        # sharing ≥2 principles indicate they study the same underlying behavior.
        concept_nodes_with_principles = []
        for campaign in project.get("campaigns", []):
            camp_name = campaign["name"]
            details = campaign_details.get(camp_name, {})
            for concept in details.get("concepts", []):
                concept_id = concept_name_to_id.get((camp_name, concept["name"]))
                if not concept_id:
                    continue
                principles = set(concept.get("principles", []))
                if principles:
                    concept_nodes_with_principles.append(
                        (concept_id, camp_name, principles)
                    )

        for i in range(len(concept_nodes_with_principles)):
            for j in range(i + 1, len(concept_nodes_with_principles)):
                # Only cross-campaign pairs
                if concept_nodes_with_principles[i][1] == concept_nodes_with_principles[j][1]:
                    continue
                shared = concept_nodes_with_principles[i][2] & concept_nodes_with_principles[j][2]
                if len(shared) >= 2:
                    pair_key = tuple(sorted([
                        concept_nodes_with_principles[i][0],
                        concept_nodes_with_principles[j][0],
                    ]))
                    if pair_key in seen:
                        continue
                    seen.add(pair_key)
                    edges.append({
                        "source": concept_nodes_with_principles[i][0],
                        "target": concept_nodes_with_principles[j][0],
                        "edgeType": "shared_principles",
                        "strength": len(shared),
                    })

    return edges


def load_campaign_costs(wiki_dir: Path, registry: dict) -> dict:
    """Load total LLM cost per campaign from llm_metrics.jsonl files.

    Returns: {campaign_name: total_cost_usd}
    """
    costs = {}
    for repo_path, project in registry.get("projects", {}).items():
        for campaign in project.get("campaigns", []):
            name = campaign["name"]
            metrics_path = wiki_dir / "campaigns" / name / "llm_metrics.jsonl"
            if metrics_path.exists():
                total = 0.0
                with open(metrics_path) as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            entry = json.loads(line)
                            total += entry.get("cost_usd") or 0
                        except (json.JSONDecodeError, ValueError):
                            continue  # skip malformed lines
                costs[name] = total
    return costs


def build_entity_clusters(registry: dict) -> list:
    """Read pre-computed entity clusters from the registry.

    Clusters are assigned at index time by /index-wiki using semantic
    analysis of entity definitions. This function maps stored entity IDs
    to names and node_ids for the HTML visualization.
    """
    clusters = []
    cluster_idx = 0

    for project in registry.get("projects", {}).values():
        id_to_name = {e["id"]: e["name"] for e in project.get("entities", [])}

        for stored in project.get("entity_clusters", []):
            names = []
            node_ids = []
            for eid in stored.get("entities", []):
                name = id_to_name.get(eid)
                if name:
                    names.append(name)
                    node_ids.append(f"entity-{eid}")
            if len(names) < 2:
                continue
            clusters.append({
                "id": cluster_idx,
                "label": stored.get("label", f"Cluster {cluster_idx}"),
                "entities": sorted(names),
                "node_ids": sorted(node_ids),
            })
            cluster_idx += 1

    return clusters


def build_retrieval_scopes(registry: dict, campaign_details: dict) -> dict:
    """Pre-compute retrieval scope per entity using retrieve_wiki_context.py logic.

    For each entity, walks: entity → operates_on → concepts → parent_concept → params,
    collecting graph node IDs that would be in scope. This is the exact same walk as
    retrieve_wiki_context.retrieve_context().

    Returns: {entity_name: [list of graph node IDs in scope]}
    """
    scopes = {}

    for repo_path, project in registry.get("projects", {}).items():
        # Build name→node_id maps
        concept_name_to_id = {}
        param_name_to_id = {}
        entity_name_to_id = {}

        for campaign in project.get("campaigns", []):
            camp_name = campaign["name"]
            for c in campaign.get("concepts", []):
                concept_name_to_id[(camp_name, c["name"])] = f"concept-{c['id']}"
            for p in campaign.get("parameters", []):
                param_name_to_id[(camp_name, p["name"])] = f"param-{p['id']}"

        for e in project.get("entities", []):
            entity_name_to_id[e["name"]] = f"entity-{e['id']}"

        # For each entity, compute its retrieval scope
        for entity in project.get("entities", []):
            entity_name = entity["name"]
            entity_id = entity_name_to_id[entity_name]
            scope_node_ids = {entity_id}

            # Walk all campaigns (same as retrieve_wiki_context with all campaigns)
            for campaign in project.get("campaigns", []):
                camp_name = campaign["name"]
                details = campaign_details.get(camp_name, {})

                # Find concepts whose operates_on includes this entity
                matched_concept_names = set()
                for concept in details.get("concepts", []):
                    if entity_name in concept.get("operates_on", []):
                        concept_id = concept_name_to_id.get(
                            (camp_name, concept["name"])
                        )
                        if concept_id:
                            scope_node_ids.add(concept_id)
                            matched_concept_names.add(concept["name"])

                # Find parameters whose parent_concept is a matched concept
                for param in details.get("parameters", []):
                    if param.get("parent_concept") in matched_concept_names:
                        param_id = param_name_to_id.get(
                            (camp_name, param["name"])
                        )
                        if param_id:
                            scope_node_ids.add(param_id)

            # Add campaign nodes that own any scope node
            for campaign in project.get("campaigns", []):
                camp_name = campaign["name"]
                camp_id = f"campaign-{camp_name}"
                for c in campaign.get("concepts", []):
                    if f"concept-{c['id']}" in scope_node_ids:
                        scope_node_ids.add(camp_id)
                        break

            scopes[entity_name] = sorted(scope_node_ids)

    return scopes


def main():
    parser = argparse.ArgumentParser(
        description="Generate cross-campaign knowledge graph visualization"
    )
    parser.add_argument(
        "--wiki", "-w",
        default=str(Path.home() / ".nous" / "wiki"),
        help="Path to wiki directory (default: ~/.nous/wiki/)",
    )
    parser.add_argument(
        "--output", "-o",
        help="Output HTML file path (default: ~/.nous/wiki/viz/registry.html)",
    )
    parser.add_argument(
        "--no-open",
        action="store_true",
        help="Don't open browser after generation",
    )
    parser.add_argument(
        "--list-clusters",
        action="store_true",
        help="Output entity clusters as JSON to stdout and exit (for skill integration)",
    )
    args = parser.parse_args()

    wiki_dir = Path(args.wiki)

    # Load data
    registry = load_registry(wiki_dir)
    campaign_details = load_campaign_details(wiki_dir, registry)

    # Pre-compute cross-node edges
    cross_edges = build_cross_edges(registry, campaign_details)

    # Read pre-computed entity clusters from registry
    entity_clusters = build_entity_clusters(registry)

    # If --list-clusters, output clusters and exit
    if args.list_clusters:
        print(json.dumps(entity_clusters, indent=2))
        sys.exit(0)

    # Pre-compute retrieval scopes per entity (using retrieve_wiki_context logic)
    retrieval_scopes = build_retrieval_scopes(registry, campaign_details)

    # Load per-campaign cost data
    campaign_costs = load_campaign_costs(wiki_dir, registry)

    # Determine output path
    if args.output:
        output_path = Path(args.output)
    else:
        viz_dir = wiki_dir / "viz"
        viz_dir.mkdir(parents=True, exist_ok=True)
        output_path = viz_dir / "registry.html"

    # Render HTML — escape </ sequences to prevent breaking <script> blocks
    def safe_json(obj, **kwargs):
        return json.dumps(obj, **kwargs).replace("</", r"<\/")

    html = HTML_TEMPLATE.format(
        registry_data_json=safe_json(registry, indent=2),
        campaign_details_json=safe_json(campaign_details),
        cross_edges_json=safe_json(cross_edges),
        retrieval_scopes_json=safe_json(retrieval_scopes),
        campaign_costs_json=safe_json(campaign_costs),
        entity_clusters_json=safe_json(entity_clusters),
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html)
    print(f"Generated: {output_path}")

    if not args.no_open:
        webbrowser.open(f"file://{output_path}")


if __name__ == "__main__":
    main()
