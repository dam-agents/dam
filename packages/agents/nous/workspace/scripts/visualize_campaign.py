#!/usr/bin/env python3
"""Generate an interactive D3.js knowledge graph for a single Nous campaign.

Reads ledger.json and principles.json from a campaign's .nous/ directory,
produces a self-contained HTML file with a force-directed graph.

Three views:
  - Iterations View: timeline of iterations with outcomes and principle sub-nodes
  - Principles View: principle-centric graph showing relationships and origins
  - Insights View: dead-ends, frontiers, and interactions from wiki (HTML cards)

Usage:
    python scripts/visualize_campaign.py <campaign_path> [--output <path>] [--wiki <path>]

    campaign_path: path to the .nous/<campaign-name>/ directory
    --output: optional output path (default: ~/.nous/wiki/viz/<campaign-name>.html)
    --wiki: path to wiki directory (default: ~/.nous/wiki/)
"""

import argparse
import json
import re
import sys
import webbrowser
from datetime import datetime, timezone
from pathlib import Path

HTML_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
  body {{ margin: 0; background: #1a1a2e; font-family: -apple-system, system-ui, sans-serif; }}
  body > svg {{ width: 100vw; height: 100vh; }}
  .legend svg {{ width: auto; height: auto; display: inline-block; vertical-align: middle; }}
  .iteration-node {{ cursor: pointer; }}
  .principle-node {{ cursor: pointer; opacity: 0; transition: opacity 0.3s; }}
  .principle-node.visible {{ opacity: 1; }}
  .link {{ stroke-opacity: 0.6; }}
  .principle-link {{ stroke-opacity: 0; transition: stroke-opacity 0.3s; }}
  .principle-link.visible {{ stroke-opacity: 0.6; }}
  .label {{ font-size: 11px; fill: #e0e0e0; pointer-events: none; text-anchor: middle; }}
  .tooltip {{
    position: absolute; background: #16213e; border: 1px solid #0f3460;
    border-radius: 6px; padding: 10px; color: #e0e0e0; font-size: 12px;
    max-width: 400px; pointer-events: none; display: none; z-index: 100;
  }}
  .legend {{
    position: absolute; top: 16px; left: 16px; background: #16213e;
    border: 1px solid #0f3460; border-radius: 6px; padding: 12px;
    color: #e0e0e0; font-size: 12px; z-index: 50;
  }}
  .legend-item {{ display: flex; align-items: center; margin: 4px 0; }}
  .legend-dot {{ width: 12px; height: 12px; border-radius: 50%; margin-right: 8px; flex-shrink: 0; }}
  .campaign-objective {{
    position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
    background: #16213e;
    border: 1px solid #0f3460; border-radius: 6px; padding: 12px 14px;
    color: #e0e0e0; font-size: 12px; z-index: 50; max-width: 480px;
  }}
  .campaign-objective.collapsed {{ padding: 6px 12px; }}
  .campaign-objective .obj-header {{
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; cursor: pointer; user-select: none;
  }}
  .campaign-objective .obj-label {{
    color: #888; font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.8px;
  }}
  .campaign-objective:not(.collapsed) .obj-header {{ margin-bottom: 6px; }}
  .campaign-objective .obj-toggle {{
    color: #888; font-size: 10px; transition: transform 0.15s;
    transform: rotate(180deg);
  }}
  .campaign-objective.collapsed .obj-toggle {{ transform: rotate(0deg); }}
  .campaign-objective .obj-header:hover .obj-label,
  .campaign-objective .obj-header:hover .obj-toggle {{ color: #ccc; }}
  .campaign-objective.collapsed .obj-body {{ display: none; }}
  .campaign-objective .obj-question {{
    color: #ccc; font-style: italic; line-height: 1.5; margin-bottom: 6px;
  }}
  .campaign-objective .obj-meta {{
    color: #777; font-size: 11px; display: flex; gap: 4px; align-items: center;
  }}
  .campaign-objective .obj-meta code {{
    background: #0a1628; padding: 1px 5px; border-radius: 3px;
    font-size: 10px; color: #b39ddb; border: 1px solid #1a2a4a;
    font-family: "SF Mono", "Fira Code", monospace;
  }}
  .view-toggle {{
    position: absolute; top: 16px; right: 16px; z-index: 50;
    display: flex; gap: 0;
  }}
  .view-btn {{
    background: #16213e; border: 1px solid #0f3460; color: #e0e0e0;
    padding: 8px 16px; cursor: pointer; font-size: 12px; transition: all 0.2s;
  }}
  .view-btn:first-child {{ border-radius: 6px 0 0 6px; }}
  .view-btn:last-child {{ border-radius: 0 6px 6px 0; }}
  .view-btn:not(:first-child):not(:last-child) {{ border-radius: 0; }}
  .view-btn.active {{ background: #0f3460; color: #fff; font-weight: bold; }}
  .view-btn:hover:not(.active) {{ background: #1a2a4a; }}
  #iter-detail-panel {{
    position: absolute; top: 0; right: 0; width: 380px; height: 100vh;
    background: #16213e; border-left: 1px solid #0f3460;
    overflow-y: auto; padding: 60px 20px 20px; box-sizing: border-box;
    display: none; z-index: 60; color: #e0e0e0; font-size: 13px; line-height: 1.6;
  }}
  #iter-detail-panel.open {{ display: block; }}
  #iter-detail-panel .panel-close {{
    position: absolute; top: 12px; right: 16px; background: none;
    border: none; color: #888; font-size: 20px; cursor: pointer;
  }}
  #iter-detail-panel .panel-close:hover {{ color: #fff; }}
  #iter-detail-panel .panel-header {{
    display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
    padding-bottom: 12px; border-bottom: 1px solid #0f3460;
  }}
  #iter-detail-panel .panel-header .outcome-dot {{
    width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0;
  }}
  #iter-detail-panel .panel-header h3 {{ margin: 0; font-size: 15px; }}
  #iter-detail-panel .panel-outcome {{
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px;
    font-weight: 600; margin-bottom: 16px;
  }}
  #iter-detail-panel .panel-summary {{ color: #ccc; margin-bottom: 16px; }}
  #iter-detail-panel .panel-field {{
    margin: 10px 0;
  }}
  #iter-detail-panel .panel-field-label {{
    color: #8899aa; font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.8px; margin-bottom: 3px;
  }}
  #iter-detail-panel .panel-field-value {{ color: #ccc; }}
  #iter-detail-panel .panel-principles {{
    margin-top: 16px; padding-top: 12px; border-top: 1px solid #0f3460;
  }}
  #iter-detail-panel .panel-principle-tag {{
    display: inline-block; background: #0f3460; border-radius: 4px;
    padding: 3px 8px; font-size: 11px; color: #b39ddb; margin: 3px 3px 3px 0;
  }}
  .chip-btn {{
    border: 1px solid #333; border-radius: 14px; padding: 4px 12px;
    font-size: 11px; cursor: pointer; background: #1a1a2e;
    transition: all 0.15s; font-family: inherit;
  }}
  .chip-btn:hover {{ filter: brightness(1.3); transform: scale(1.03); }}
  .chip-concept {{ color: #9fa8da; border-color: #5c6bc0; }}
  .chip-param {{ color: #ce93d8; border-color: #7b1fa2; }}
  .chip-entity {{ color: #a5d6a7; border-color: #388e3c; }}
  #insights-container {{
    display: none; padding: 80px 40px 40px; height: 100vh; overflow-y: auto;
    box-sizing: border-box;
  }}
  #summary-container {{
    display: none; padding: 80px 40px 60px; height: 100vh; overflow-y: auto;
    box-sizing: border-box; max-width: 780px; margin: 0 auto;
  }}
  #summary-container .summary-inner {{
    background: #16213e; border-radius: 12px; padding: 36px 40px 40px;
    border: 1px solid #0f3460;
  }}
  #summary-container h1 {{
    color: #fff; font-size: 20px; margin: 0 0 8px; font-weight: 700;
    letter-spacing: -0.3px;
  }}
  #summary-container .summary-meta {{
    display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 28px;
    padding-bottom: 16px; border-bottom: 1px solid #0f3460;
  }}
  #summary-container .summary-meta span {{
    color: #888; font-size: 12px;
  }}
  #summary-container .summary-meta strong {{ color: #b0bec5; font-weight: 600; }}
  #summary-container .summary-question {{
    color: #9fa8da; font-style: italic; line-height: 1.6; font-size: 13px;
    margin: 0 0 28px; padding: 12px 16px;
    background: rgba(79, 91, 213, 0.08); border-radius: 6px;
    border-left: 3px solid #5c6bc0;
  }}
  #summary-container h2 {{
    font-size: 13px; margin: 28px 0 12px; padding: 0;
    text-transform: uppercase; letter-spacing: 1px; font-weight: 700;
  }}
  #summary-container h2.outcome-heading {{ color: #4caf50; }}
  #summary-container h2.arc-heading {{ color: #64b5f6; }}
  #summary-container h2.principles-heading {{ color: #b39ddb; }}
  #summary-container h2.questions-heading {{ color: #ffb74d; }}
  #summary-container p {{
    color: #ccc; line-height: 1.75; margin: 8px 0; font-size: 13.5px;
  }}
  #summary-container ul, #summary-container ol {{
    color: #ccc; line-height: 1.8; padding-left: 20px; margin: 8px 0;
  }}
  #summary-container li {{
    margin: 6px 0; font-size: 13px; padding-left: 4px;
  }}
  #summary-container li::marker {{ color: #555; }}
  #summary-container strong {{ color: #e0e0e0; font-weight: 600; }}
  #summary-container code {{
    background: #0a1628; padding: 2px 7px; border-radius: 3px;
    font-size: 12px; color: #b39ddb; border: 1px solid #1a2a4a;
  }}
  .summary-fallback {{ color: #888; font-size: 14px; text-align: center; padding: 80px 20px; font-style: italic; }}
  .insights-nav {{
    display: flex; gap: 0; max-width: 1100px; margin: 0 auto 24px;
    border-radius: 8px; overflow: hidden; border: 1px solid #0f3460;
  }}
  .insights-nav-btn {{
    flex: 1; padding: 12px 16px; background: #16213e; border: none;
    color: #888; font-size: 13px; cursor: pointer; transition: all 0.2s;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    border-right: 1px solid #0f3460;
  }}
  .insights-nav-btn:last-child {{ border-right: none; }}
  .insights-nav-btn:hover:not(.active) {{ background: #1a2a4a; color: #aaa; }}
  .insights-nav-btn.active {{ background: #0f3460; }}
  .insights-nav-btn .nav-title {{ font-weight: 700; font-size: 13px; }}
  .insights-nav-btn .nav-desc {{ font-size: 10px; opacity: 0.7; }}
  .insights-nav-btn .nav-count {{
    font-size: 10px; opacity: 0.5; margin-top: 2px;
  }}
  .insights-sections {{
    max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 40px;
  }}
  .insights-section {{ margin: 0; display: none; }}
  .insights-section.active {{ display: block; }}
  .insights-cards {{
    display: flex; flex-wrap: wrap; gap: 16px;
  }}
  .insight-card {{
    flex: 1 1 300px; max-width: 500px;
  }}
  .insight-card {{
    background: #16213e; border-radius: 10px; padding: 20px 24px;
    border-left: 4px solid #555; color: #e0e0e0; font-size: 13px; line-height: 1.7;
    word-wrap: break-word; overflow-wrap: break-word;
  }}
  .insight-card h4 {{
    margin: 0 0 14px; font-size: 15px; font-weight: 600;
    line-height: 1.4;
  }}
  .insight-card .field {{
    margin: 10px 0; padding: 0;
  }}
  .insight-card .field-label {{
    color: #8899aa; font-weight: 600; font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.8px;
    margin-bottom: 3px; display: block;
  }}
  .insight-card .field-value {{
    color: #ccc; display: block;
  }}
  .insight-card--dead-end {{ border-left-color: #f44336; }}
  .insight-card--dead-end h4 {{ color: #ef5350; }}
  .insight-card--frontier {{ border-left-color: #ff9800; }}
  .insight-card--frontier h4 {{ color: #ffb74d; }}
  .insight-card--interaction {{ border-left-color: #2196f3; }}
  .insight-card--interaction h4 {{ color: #64b5f6; }}
  .insights-fallback {{
    color: #888; font-size: 14px; text-align: center; padding: 80px 20px;
    font-style: italic;
  }}
  /* Timeline animation controls */
  #timeline-controls {{
    position: absolute; bottom: 16px; right: 16px; z-index: 50;
    display: none; align-items: center; gap: 10px;
    background: #16213e; border: 1px solid #0f3460; border-radius: 8px;
    padding: 10px 16px;
  }}
  #timeline-controls.visible {{ display: flex; }}
  #timeline-play-btn {{
    background: none; border: 1px solid #0f3460; color: #e0e0e0;
    width: 32px; height: 32px; border-radius: 50%; cursor: pointer;
    font-size: 14px; display: flex; align-items: center; justify-content: center;
    transition: all 0.2s;
  }}
  #timeline-play-btn:hover {{ background: #0f3460; }}
  #timeline-slider {{
    width: 200px; accent-color: #5c6bc0; cursor: pointer;
  }}
  #timeline-label {{
    color: #e0e0e0; font-size: 12px; min-width: 50px; text-align: center;
  }}
  #timeline-dismiss {{
    background: none; border: none; color: #666; font-size: 16px;
    cursor: pointer; padding: 0 4px; margin-left: 4px;
  }}
  #timeline-dismiss:hover {{ color: #e0e0e0; }}
  #timeline-trigger {{
    position: absolute; bottom: 16px; right: 16px; z-index: 50;
    background: #16213e; border: 1px solid #0f3460; border-radius: 6px;
    padding: 8px 14px; color: #e0e0e0; font-size: 12px; cursor: pointer;
    transition: all 0.2s; display: none;
  }}
  #timeline-trigger:hover {{ background: #0f3460; }}
  #timeline-trigger.visible {{ display: block; }}
  #timeline-narrative {{
    position: absolute; bottom: 70px; right: 16px; z-index: 50;
    max-width: 360px; display: none;
    background: #16213e; border: 1px solid #0f3460; border-radius: 8px;
    padding: 10px 14px; font-size: 12px; line-height: 1.5;
    color: #e0e0e0; transition: opacity 0.3s;
  }}
  #timeline-narrative.visible {{ display: block; }}
  #timeline-narrative .narr-title {{ font-weight: 600; margin-bottom: 4px; }}
  #timeline-narrative .narr-family {{
    font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px;
  }}
  .revisit-arc {{ stroke-dasharray: 6,3; fill: none; pointer-events: none; }}
  /* Cost bar chart */
  #cost-chart {{
    position: absolute; left: 16px; z-index: 50;
    background: #16213e; border: 1px solid #0f3460; border-radius: 6px;
    padding: 12px; display: none; box-sizing: border-box;
  }}
  #cost-chart.visible {{ display: block; }}
  #cost-chart .cost-title {{
    color: #888; font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.8px; margin-bottom: 8px;
  }}
  #cost-chart .cost-total {{
    color: #e0e0e0; font-size: 12px; margin-bottom: 10px;
  }}
  #cost-chart .cost-bars {{
    display: flex; align-items: flex-end; gap: 4px; height: 140px;
  }}
  #cost-chart .cost-bar-group {{
    display: flex; flex-direction: column; align-items: center; gap: 0;
    flex: 1; min-width: 0;
  }}
  #cost-chart .cost-bar-stack {{
    display: flex; flex-direction: column; justify-content: flex-end;
    width: 100%; height: 140px; border-radius: 2px 2px 0 0; overflow: hidden;
  }}
  #cost-chart .cost-bar-design {{
    background: #ef6c00; width: 100%;
  }}
  #cost-chart .cost-bar-execute {{
    background: #00acc1; width: 100%;
  }}
  #cost-chart .cost-bar-label {{
    color: #888; font-size: 8px; margin-top: 3px; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; max-width: 100%; text-align: center;
  }}
  #cost-chart .cost-legend {{
    display: flex; gap: 12px; margin-top: 8px; font-size: 10px; color: #888;
  }}
  #cost-chart .cost-legend-item {{
    display: flex; align-items: center; gap: 4px;
  }}
  #cost-chart .cost-legend-dot {{
    width: 8px; height: 8px; border-radius: 2px;
  }}
  /* Hypothesis arms in panel */
  .hyp-arms {{ margin-top: 16px; padding-top: 12px; border-top: 1px solid #0f3460; }}
  .hyp-arms-label {{ color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px; }}
  .hyp-arm {{
    margin: 8px 0; padding: 8px 10px; border-radius: 6px;
    background: rgba(255,255,255,0.03); border-left: 3px solid #555;
    cursor: pointer; transition: background 0.15s;
  }}
  .hyp-arm:hover {{ background: rgba(255,255,255,0.06); }}
  .hyp-arm-header {{ display: flex; align-items: center; gap: 8px; }}
  .hyp-arm-type {{ font-size: 11px; font-weight: 600; color: #ccc; }}
  .hyp-arm-status {{
    font-size: 9px; font-weight: 700; padding: 1px 6px;
    border-radius: 3px; text-transform: uppercase; letter-spacing: 0.5px;
  }}
  .hyp-arm-detail {{
    display: none; margin-top: 8px; font-size: 11px; line-height: 1.6;
  }}
  .hyp-arm.expanded .hyp-arm-detail {{ display: block; }}
  .hyp-arm-detail .hyp-field {{ margin: 4px 0; }}
  .hyp-arm-detail .hyp-field-label {{ color: #8899aa; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }}
  .hyp-arm-detail .hyp-field-value {{ color: #bbb; }}
</style>
</head>
<body>
<div class="view-toggle">
  <button class="view-btn active" onclick="switchView('iterations')">Iterations</button>
  <button class="view-btn" onclick="switchView('principles')">Knowledge</button>
  <button class="view-btn" onclick="switchView('insights')">Insights</button>
  <button class="view-btn" onclick="switchView('summary')">Summary</button>
</div>

<div class="legend" id="legend-iterations">
    <strong style="margin-bottom:8px;display:block;">{title}</strong>
    <div style="margin-bottom:8px;border-bottom:1px solid #0f3460;padding-bottom:8px;">
      <div style="color:#888;font-size:10px;margin-bottom:4px;">NODES</div>
      <div class="legend-item"><div class="legend-dot" style="background:#4caf50"></div>Confirmed hypothesis</div>
      <div class="legend-item"><div class="legend-dot" style="background:#f44336"></div>Refuted hypothesis</div>
      <div class="legend-item"><div class="legend-dot" style="background:#ff9800"></div>Partially confirmed</div>
      <div class="legend-item"><div class="legend-dot" style="background:#9e9e9e"></div>Baseline</div>
      <div class="legend-item"><div class="legend-dot" style="background:#5c6bc0;border-radius:3px;width:10px;height:10px"></div>Concept (click iteration)</div>
      <div class="legend-item"><svg width="14" height="14" style="margin-right:8px;"><polygon points="7,2 12,12 2,12" fill="#4a148c" stroke="#ce93d8" stroke-width="1.5"/></svg>Parameter (click iteration)</div>
      <div class="legend-item"><div class="legend-dot" style="background:#66bb6a;transform:rotate(45deg);border-radius:2px;width:9px;height:9px"></div>Entity (click iteration)</div>
    </div>
    <div style="margin-bottom:8px;border-bottom:1px solid #0f3460;padding-bottom:8px;">
      <div style="color:#888;font-size:10px;margin-bottom:4px;">EDGES</div>
      <div class="legend-item"><svg width="24" height="12"><line x1="0" y1="6" x2="24" y2="6" stroke="#555" stroke-width="2" stroke-dasharray="4,4"/></svg><span style="margin-left:8px;">Timeline sequence</span></div>
      <div class="legend-item"><svg width="24" height="12"><line x1="0" y1="6" x2="24" y2="6" stroke="#5c6bc0" stroke-width="1"/></svg><span style="margin-left:8px;">Concept/entity link</span></div>
      <div class="legend-item"><svg width="24" height="12"><path d="M0,10 Q12,0 24,10" fill="none" stroke="#ffb74d" stroke-width="1.5" stroke-dasharray="3,2"/></svg><span style="margin-left:8px;">Revisited earlier idea</span></div>
    </div>
    <div>
      <div style="color:#888;font-size:10px;margin-bottom:4px;">INTERACTIONS</div>
      <div style="color:#aaa;font-size:11px;line-height:1.5;">
        <strong>Click</strong> iteration &rarr; show/hide concepts<br>
        <strong>Hover</strong> any node &rarr; see details<br>
        <strong>Drag</strong> node &rarr; rearrange<br>
        <strong>Scroll</strong> &rarr; zoom &bull; <strong>Drag bg</strong> &rarr; pan<br>
        <strong>Play timeline</strong> &rarr; animate graph evolution
      </div>
    </div>
</div>

<div class="legend" id="legend-principles" style="display:none;">
  <strong style="margin-bottom:8px;display:block;">{title} &mdash; Knowledge Graph</strong>
  <div style="margin-bottom:8px;border-bottom:1px solid #0f3460;padding-bottom:8px;">
    <div style="color:#888;font-size:10px;margin-bottom:4px;">NODES</div>
    <div class="legend-item"><div class="legend-dot" style="background:#1a237e;border:2px solid #5c6bc0;border-radius:3px;width:12px;height:12px"></div>Concept (technique/algorithm)</div>
    <div class="legend-item"><svg width="14" height="14" style="margin-right:8px;"><polygon points="7,1 13,12 1,12" fill="#4a148c" stroke="#ce93d8" stroke-width="1.5"/></svg>Parameter (config knob)</div>
    <div class="legend-item"><div class="legend-dot" style="background:#1b5e20;border:2px solid #66bb6a;transform:rotate(45deg);border-radius:2px;width:10px;height:10px"></div>Entity (system component)</div>
  </div>
  <div style="margin-bottom:8px;border-bottom:1px solid #0f3460;padding-bottom:8px;">
    <div style="color:#888;font-size:10px;margin-bottom:4px;">EDGES</div>
    <div class="legend-item"><svg width="24" height="12"><line x1="0" y1="6" x2="24" y2="6" stroke="rgba(255,255,255,0.3)" stroke-width="2"/></svg><span style="margin-left:8px;">Shared principles (thicker = more)</span></div>
  </div>
  <div style="margin-bottom:8px;border-bottom:1px solid #0f3460;padding-bottom:8px;">
    <div style="color:#888;font-size:10px;margin-bottom:4px;">PRINCIPLE CONFIDENCE</div>
    <div class="legend-item"><div class="legend-dot" style="background:#4caf50;width:8px;height:8px;border-radius:50%;"></div>High</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ff9800;width:8px;height:8px;border-radius:50%;"></div>Medium</div>
    <div class="legend-item"><div class="legend-dot" style="background:#f44336;width:8px;height:8px;border-radius:50%;"></div>Low</div>
  </div>
  <div>
    <div style="color:#888;font-size:10px;margin-bottom:4px;">INTERACTIONS</div>
    <div style="color:#aaa;font-size:11px;line-height:1.5;">
      <strong>Click</strong> node &rarr; see definition + principles<br>
      <strong>Hover</strong> node &rarr; quick info<br>
      <strong>Drag</strong> node &rarr; rearrange<br>
      <strong>Scroll</strong> &rarr; zoom &bull; <strong>Drag bg</strong> &rarr; pan<br>
      <strong>Node size</strong> = connections to other concepts
    </div>
  </div>
</div>

<div class="campaign-objective" id="campaign-objective-box" style="display:none;"></div>

<div id="insights-container"></div>
<div id="summary-container"></div>
<div id="iter-detail-panel">
  <button class="panel-close" onclick="closeIterPanel()">&times;</button>
  <div id="iter-detail-content"></div>
</div>
<div id="cost-chart"></div>
<div class="tooltip" id="tooltip"></div>
<div id="timeline-narrative"></div>
<button id="timeline-trigger" onclick="startTimeline()">&#9654; Play timeline</button>
<div id="timeline-controls">
  <button id="timeline-play-btn" onclick="toggleTimelinePlay()">&#9654;</button>
  <input type="range" id="timeline-slider" min="0" max="1" value="0" oninput="scrubTimeline(this.value)">
  <span id="timeline-label">0 / 0</span>
  <button id="timeline-dismiss" onclick="dismissTimeline()">&times;</button>
</div>
<script src="d3.v7.min.js"></script>
<script>if(typeof d3==="undefined")document.write('<script src="https://d3js.org/d3.v7.min.js"><\\/script>')</script>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script>
const iterData = {iter_data_json};
const princData = {princ_data_json};
const insightsData = {insights_data_json};
const iterSummaries = {iter_summaries_json};
const campaignContext = {campaign_context_json};
const conceptsData = {concepts_data_json};
const summaryMd = {summary_md_json};
const knowledgeGraph = {knowledge_graph_json};
const findingsData = {findings_data_json};
const narrativesData = {narratives_data_json};
const llmMetrics = {llm_metrics_json};

let currentView = "iterations";

// Render campaign objective box (top-center). Collapsible; persists across reloads via localStorage.
const OBJECTIVE_COLLAPSED_KEY = "nous-viz-objective-collapsed";
function toggleObjective() {{
  const box = document.getElementById("campaign-objective-box");
  if (!box) return;
  const nowCollapsed = !box.classList.contains("collapsed");
  box.classList.toggle("collapsed", nowCollapsed);
  try {{ localStorage.setItem(OBJECTIVE_COLLAPSED_KEY, nowCollapsed ? "1" : "0"); }} catch (e) {{}}
}}
if (campaignContext && (campaignContext.research_question || campaignContext.target_commit)) {{
  const box = document.getElementById("campaign-objective-box");
  if (box) {{
    let bodyHtml = '';
    if (campaignContext.research_question) {{
      bodyHtml += '<div class="obj-question">' + campaignContext.research_question + '</div>';
    }}
    const metaParts = [];
    if (campaignContext.target_commit) {{
      const shortSha = campaignContext.target_commit.substring(0, 7);
      const repoLabel = campaignContext.target_repo || "";
      metaParts.push('<span class="obj-meta-item" title="' + campaignContext.target_commit + '">commit <code>' + shortSha + '</code>' + (repoLabel ? ' on ' + repoLabel : '') + '</span>');
    }}
    if (campaignContext.nous_version) {{
      const shortVer = campaignContext.nous_version.length > 12 ? campaignContext.nous_version.substring(0, 7) : campaignContext.nous_version;
      metaParts.push('<span class="obj-meta-item">nous <code>' + shortVer + '</code></span>');
    }}
    if (metaParts.length > 0) {{
      bodyHtml += '<div class="obj-meta">' + metaParts.join(' &middot; ') + '</div>';
    }}
    box.innerHTML =
      '<div class="obj-header" onclick="toggleObjective()">' +
        '<span class="obj-label">Research Objective</span>' +
        '<span class="obj-toggle">&#9662;</span>' +
      '</div>' +
      '<div class="obj-body">' + bodyHtml + '</div>';
    let startCollapsed = true;
    try {{
      const stored = localStorage.getItem(OBJECTIVE_COLLAPSED_KEY);
      if (stored === "0") startCollapsed = false;
    }} catch (e) {{}}
    box.classList.toggle("collapsed", startCollapsed);
    box.style.display = "block";
  }}
}}

// --- Cost bar chart ---
function renderCostChart() {{
  const chart = document.getElementById("cost-chart");
  if (!llmMetrics || Object.keys(llmMetrics).length === 0) {{
    chart.classList.remove("visible");
    return;
  }}

  const iterIds = Object.keys(llmMetrics).sort((a, b) =>
    parseInt(a.replace("iter-", "")) - parseInt(b.replace("iter-", ""))
  );
  const maxCost = Math.max(...iterIds.map(id => llmMetrics[id].total_cost));
  const totalCampaignCost = iterIds.reduce((sum, id) => sum + llmMetrics[id].total_cost, 0);

  let html = '<div class="cost-title">Cost per Iteration</div>';
  html += `<div class="cost-total">Campaign total: <strong style="color:#fff">$${{totalCampaignCost.toFixed(2)}}</strong></div>`;
  html += '<div class="cost-bars">';

  iterIds.forEach(id => {{
    const m = llmMetrics[id];
    const designCost = m.design ? m.design.cost_usd : 0;
    const execCost = m.execute ? m.execute.cost_usd : 0;
    const designH = maxCost > 0 ? (designCost / maxCost) * 140 : 0;
    const executeH = maxCost > 0 ? (execCost / maxCost) * 140 : 0;
    const label = id.replace("iter-", "");
    const tooltipText = `$${{m.total_cost.toFixed(2)}} (design: $${{designCost.toFixed(2)}}, exec: $${{execCost.toFixed(2)}})`;
    html += `<div class="cost-bar-group">`;
    html += `<div class="cost-bar-stack" title="${{tooltipText}}">`;
    html += `<div class="cost-bar-design" style="height:${{designH}}px"></div>`;
    html += `<div class="cost-bar-execute" style="height:${{executeH}}px"></div>`;
    html += `</div>`;
    html += `<div class="cost-bar-label">${{label}}</div>`;
    html += `</div>`;
  }});

  html += '</div>';
  html += '<div class="cost-legend">';
  html += '<div class="cost-legend-item"><div class="cost-legend-dot" style="background:#ef6c00"></div>Design (Opus)</div>';
  html += '<div class="cost-legend-item"><div class="cost-legend-dot" style="background:#00acc1"></div>Execute (Sonnet)</div>';
  html += '</div>';

  chart.innerHTML = html;
  chart.classList.add("visible");
  // Position below the visible legend, match its width
  const legend = document.getElementById("legend-iterations");
  if (legend && legend.style.display !== "none") {{
    chart.style.top = (legend.offsetTop + legend.offsetHeight + 12) + "px";
    chart.style.width = legend.offsetWidth + "px";
  }} else {{
    chart.style.top = "16px";
  }}
}}

let simulation, svg, g;

function switchView(view) {{
  if (view === currentView) return;
  currentView = view;
  document.querySelectorAll(".view-btn").forEach(b => b.classList.remove("active"));
  document.querySelector(`.view-btn[onclick="switchView('${{view}}')"]`).classList.add("active");
  document.getElementById("legend-iterations").style.display = view === "iterations" ? "block" : "none";
  document.getElementById("legend-principles").style.display = view === "principles" ? "block" : "none";
  const objBox = document.getElementById("campaign-objective-box");
  if (objBox && objBox.innerHTML) {{
    objBox.style.display = (view === "iterations" || view === "principles") ? "block" : "none";
  }}
  // Cost chart: only visible in iterations view
  const costChart = document.getElementById("cost-chart");
  if (view === "iterations") {{
    renderCostChart();
  }} else {{
    costChart.classList.remove("visible");
  }}
  // Timeline controls: dismiss when leaving iterations, show trigger when entering
  if (view !== "iterations") {{
    if (timelineActive) dismissTimeline();
    document.getElementById("timeline-trigger").classList.remove("visible");
    document.getElementById("timeline-controls").classList.remove("visible");
  }} else {{
    if (!timelineActive) document.getElementById("timeline-trigger").classList.add("visible");
  }}
  const insightsEl = document.getElementById("insights-container");
  const summaryEl = document.getElementById("summary-container");
  if (view === "insights") {{
    // Hide SVG graph, show insights
    const svgEl = document.querySelector("body > svg");
    if (svgEl) svgEl.style.display = "none";
    insightsEl.style.display = "block";
    summaryEl.style.display = "none";
    renderInsights();
  }} else if (view === "summary") {{
    const svgEl = document.querySelector("body > svg");
    if (svgEl) svgEl.style.display = "none";
    insightsEl.style.display = "none";
    summaryEl.style.display = "block";
    renderSummary();
  }} else {{
    insightsEl.style.display = "none";
    summaryEl.style.display = "none";
    render(view === "iterations" ? iterData : princData, view);
  }}
}}

function renderSummary() {{
  const container = document.getElementById("summary-container");
  if (!summaryMd) {{
    container.innerHTML = '<div class="summary-fallback">No summary available. Run /post-campaign to generate summary.md.</div>';
    return;
  }}
  // Parse markdown and wrap in styled container
  let html = marked.parse(summaryMd);

  // Extract metadata lines (Date, Iterations, Key question) into a styled header
  const metaRegex = /<p><strong>(.+?)<\/strong>\s*(.+?)<br>\s*<strong>(.+?)<\/strong>\s*(.+?)<br>\s*<strong>(.+?)<\/strong>\s*([\s\S]*?)<\/p>/;
  const metaMatch = html.match(metaRegex);
  if (metaMatch) {{
    const metaHtml = `<div class="summary-meta"><span><strong>${{metaMatch[1]}}</strong> ${{metaMatch[2]}}</span><span><strong>${{metaMatch[3]}}</strong> ${{metaMatch[4]}}</span></div>`
      + `<div class="summary-question">${{metaMatch[6].trim()}}</div>`;
    html = html.replace(metaMatch[0], metaHtml);
  }}

  // Add semantic classes to h2 headings based on content
  html = html.replace(/<h2[^>]*>Outcome<\/h2>/i, '<h2 class="outcome-heading">Outcome</h2>');
  html = html.replace(/<h2[^>]*>Iteration arc<\/h2>/i, '<h2 class="arc-heading">Iteration Arc</h2>');
  html = html.replace(/<h2[^>]*>Key principles<\/h2>/i, '<h2 class="principles-heading">Key Principles</h2>');
  html = html.replace(/<h2[^>]*>Open questions<\/h2>/i, '<h2 class="questions-heading">Open Questions</h2>');

  container.innerHTML = '<div class="summary-inner">' + html + '</div>';
}}

function renderInsights() {{
  const container = document.getElementById("insights-container");
  const sections = [
    {{ key: "dead_ends", title: "Dead Ends", cssClass: "dead-end", color: "#f44336",
       desc: "Approaches that were tested and conclusively don't work",
       fields: [["what_was_tried", "What was tried"], ["why_it_failed", "Why it failed"], ["avoid_when", "Avoid when"]] }},
    {{ key: "frontiers", title: "Frontiers", cssClass: "frontier", color: "#ff9800",
       desc: "Edges of exploration — what was tried, what wasn't, and what to try next",
       fields: [["what_was_tried", "What was tried"], ["what_was_left_untried", "Left untried"], ["what_to_try_next", "Try next"]] }},
    {{ key: "interactions", title: "Interactions", cssClass: "interaction", color: "#2196f3",
       desc: "Untested combinations of validated approaches — experiments to run next",
       fields: [["approach_a", "Approach A"], ["approach_b", "Approach B"], ["why_combine", "Why combine"], ["experiment_to_run", "Experiment"]] }},
  ];

  const hasAny = sections.some(s => insightsData[s.key]);
  if (!hasAny) {{
    container.innerHTML = '<div class="insights-fallback">Run /post-campaign to generate insights</div>';
    return;
  }}

  function renderMarkdownInline(text) {{
    return text.replace(/\\*\\*(.+?)\\*\\*/g, '<strong style="color:#e0e0e0">$1</strong>');
  }}

  function renderBulletLine(line) {{
    const cleaned = line.replace(/^[-*]\\s*/, "").trim();
    const fieldMatch = cleaned.match(/^\\*\\*(.+?):?\\*\\*:?\\s*(.*)/);
    if (fieldMatch) {{
      const label = fieldMatch[1].replace(/:$/, "");
      const value = fieldMatch[2];
      if (value) {{
        return `<div class="field"><span class="field-label">${{label}}</span><span class="field-value">${{renderMarkdownInline(value)}}</span></div>`;
      }} else {{
        return `<div class="field"><span class="field-value" style="color:#e0e0e0;font-weight:600">${{label}}</span></div>`;
      }}
    }}
    return `<div class="field"><span class="field-value">${{renderMarkdownInline(cleaned)}}</span></div>`;
  }}

  function renderJsonEntry(entry, fieldDefs) {{
    let body = "";
    for (const [key, label] of fieldDefs) {{
      const value = entry[key];
      if (value) {{
        body += `<div class="field"><span class="field-label">${{label}}</span><span class="field-value">${{value}}</span></div>`;
      }}
    }}
    if (entry.related_principles && entry.related_principles.length) {{
      body += `<div class="field"><span class="field-label">Related</span><span class="field-value">${{entry.related_principles.join(", ")}}</span></div>`;
    }}
    return body;
  }}

  function getCount(data) {{
    if (!data) return 0;
    if (Array.isArray(data)) return data.length;
    if (typeof data === "string") return (data.match(/^### /gm) || []).length;
    return 0;
  }}

  // Build nav bar
  let html = '<div class="insights-nav">';
  for (let i = 0; i < sections.length; i++) {{
    const section = sections[i];
    const data = insightsData[section.key];
    const count = getCount(data);
    const activeClass = i === 0 ? " active" : "";
    html += `<button class="insights-nav-btn${{activeClass}}" style="color:${{i === 0 ? section.color : ''}}" onclick="switchInsightTab(${{i}})" data-idx="${{i}}" data-color="${{section.color}}">`;
    html += `<span class="nav-title">${{section.title}}</span>`;
    html += `<span class="nav-desc">${{section.desc}}</span>`;
    html += `<span class="nav-count">${{count}} item${{count !== 1 ? "s" : ""}}</span>`;
    html += `</button>`;
  }}
  html += '</div>';

  // Build section panels
  html += '<div class="insights-sections">';
  for (let i = 0; i < sections.length; i++) {{
    const section = sections[i];
    const data = insightsData[section.key];
    const activeClass = i === 0 ? " active" : "";
    html += `<div class="insights-section${{activeClass}}" data-section="${{i}}">`;

    if (!data) {{
      html += `<div class="insight-card insight-card--${{section.cssClass}}"><p style="color:#666;font-style:italic;margin:0;">No data available</p></div>`;
    }} else if (Array.isArray(data)) {{
      // New JSON array format
      html += `<div class="insights-cards">`;
      for (const entry of data) {{
        const title = entry.title || "Untitled";
        const iterTag = entry.iteration ? ` <span style="color:#888;font-size:0.8em">(${{entry.iteration}})</span>` : "";
        const body = renderJsonEntry(entry, section.fields);
        html += `<div class="insight-card insight-card--${{section.cssClass}}"><h4>${{title}}${{iterTag}}</h4>${{body}}</div>`;
      }}
      html += `</div>`;
    }} else {{
      // Legacy markdown string format (backward compatibility)
      html += `<div class="insights-cards">`;
      const chunks = data.split(/^### /m).filter(c => c.trim());
      for (const chunk of chunks) {{
        const lines = chunk.split("\\n");
        const title = lines[0].trim();
        if (!title || !lines.slice(1).some(l => /^[-*]\\s/.test(l.trim()))) continue;
        const bodyLines = lines.slice(1).filter(l => l.trim());
        const body = bodyLines.map(l => renderBulletLine(l)).join("");
        html += `<div class="insight-card insight-card--${{section.cssClass}}"><h4>${{renderMarkdownInline(title)}}</h4>${{body}}</div>`;
      }}
      html += `</div>`;
    }}
    html += `</div>`;
  }}
  html += '</div>';
  container.innerHTML = html;
}}

function showIterPanel(d) {{
  resetEdgeHighlights();
  const panel = document.getElementById("iter-detail-panel");
  const content = document.getElementById("iter-detail-content");
  const colorMap = {{ "CONFIRMED": "#4caf50", "REFUTED": "#f44336", "PARTIALLY_CONFIRMED": "#ff9800", "BASELINE": "#9e9e9e" }};
  const color = colorMap[d.outcome] || "#9e9e9e";
  const summary = iterSummaries[d.id];

  let html = `<div class="panel-header">`;
  html += `<div class="outcome-dot" style="background:${{color}}"></div>`;
  html += `<h3>${{d.label}}</h3>`;
  html += `</div>`;
  html += `<div class="panel-outcome" style="color:${{color}}">${{d.outcome || "BASELINE"}}</div>`;

  if (summary) {{
    html += `<div class="panel-field"><div class="panel-field-label">What was tried</div><div class="panel-field-value">${{summary.what_was_tried || "—"}}</div></div>`;
    html += `<div class="panel-field"><div class="panel-field-label">What was found</div><div class="panel-field-value">${{summary.what_was_found || "—"}}</div></div>`;
    html += `<div class="panel-field"><div class="panel-field-label">Why it matters</div><div class="panel-field-value">${{summary.why_it_matters || "—"}}</div></div>`;
  }} else {{
    html += `<div class="panel-summary" style="color:#666;font-style:italic;">No summary available. Run /visualize-campaign to generate.</div>`;
  }}

  // Show hypothesis arms from findings
  const arms = findingsData[d.id];
  if (arms && arms.length > 0) {{
    const statusColors = {{ "CONFIRMED": "#4caf50", "REFUTED": "#f44336", "PARTIALLY_CONFIRMED": "#ff9800" }};
    const armLabels = {{ "h-main": "Main Hypothesis", "h-control-negative": "Negative Control", "h-robustness": "Robustness", "h-ablation": "Ablation" }};
    function escHtml(str) {{
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }}
    html += `<div class="hyp-arms"><div class="hyp-arms-label">Hypothesis Arms</div>`;
    arms.forEach((arm, idx) => {{
      const sc = statusColors[arm.status] || "#9e9e9e";
      const label = armLabels[arm.arm_type] || arm.arm_type;
      const bgColor = arm.status === "CONFIRMED" ? "rgba(76,175,80,0.15)" : arm.status === "REFUTED" ? "rgba(244,67,54,0.15)" : "rgba(255,152,0,0.15)";
      html += `<div class="hyp-arm" style="border-left-color:${{sc}}" onclick="this.classList.toggle('expanded')">`;
      html += `<div class="hyp-arm-header"><span class="hyp-arm-type">${{label}}</span>`;
      html += `<span class="hyp-arm-status" style="color:${{sc}};background:${{bgColor}}">${{arm.status}}</span></div>`;
      html += `<div class="hyp-arm-detail">`;
      if (arm.predicted) html += `<div class="hyp-field"><div class="hyp-field-label">Predicted</div><div class="hyp-field-value">${{escHtml(arm.predicted)}}</div></div>`;
      if (arm.observed) html += `<div class="hyp-field"><div class="hyp-field-label">Observed</div><div class="hyp-field-value">${{escHtml(arm.observed)}}</div></div>`;
      if (arm.diagnostic_note) html += `<div class="hyp-field"><div class="hyp-field-label">Diagnostic</div><div class="hyp-field-value">${{escHtml(arm.diagnostic_note)}}</div></div>`;
      html += `</div></div>`;
    }});
    html += `</div>`;
  }}

  // Show related concepts and entities (by principle overlap OR summary mention)
  if (conceptsData) {{
    const iterPrinciples = d.principles || [];
    const summaryText = (function() {{
      const s = iterSummaries[d.id];
      if (!s) return "";
      return [s.what_was_tried || "", s.what_was_found || "", s.why_it_matters || ""].join(" ").toLowerCase();
    }})();
    function panelMentions(name) {{
      const terms = [name.toLowerCase()];
      const pm = name.match(/^([^(]+)\s*\(/);
      if (pm) terms.push(pm[1].trim().toLowerCase());
      const am = name.match(/\(([^)]+)\)/);
      if (am) terms.push(am[1].trim().toLowerCase());
      return terms.some(t => summaryText.includes(t));
    }}
    const relatedConcepts = (conceptsData.concepts || []).filter(c =>
      c.principles.some(pid => iterPrinciples.includes(pid)) || panelMentions(c.name)
    );
    const relatedParams = (conceptsData.parameters || []).filter(p =>
      p.principles.some(pid => iterPrinciples.includes(pid)) || panelMentions(p.name)
    );
    const relatedEntities = (conceptsData.entities || []).filter(ent =>
      ent.principles.some(pid => iterPrinciples.includes(pid)) || panelMentions(ent.name)
    );
    if (relatedConcepts.length > 0 || relatedParams.length > 0 || relatedEntities.length > 0) {{
      html += `<div class="panel-principles" style="margin-top:12px;padding-top:12px;border-top:1px solid #0f3460;">`;
      if (relatedConcepts.length > 0) {{
        html += `<div class="panel-field-label" style="margin-bottom:6px;">Concepts</div>`;
        html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">`;
        relatedConcepts.forEach(c => {{
          const cid = "concept-" + c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          html += `<button class="chip-btn chip-concept" onclick="openChipPanel('${{cid}}', 'concept')">${{c.name}}</button>`;
        }});
        html += `</div>`;
      }}
      if (relatedParams.length > 0) {{
        html += `<div class="panel-field-label" style="margin-bottom:6px;">Parameters</div>`;
        html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">`;
        relatedParams.forEach(p => {{
          const pid = "param-" + p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          html += `<button class="chip-btn chip-param" onclick="openChipPanel('${{pid}}', 'parameter')">${{p.name}}</button>`;
        }});
        html += `</div>`;
      }}
      if (relatedEntities.length > 0) {{
        html += `<div class="panel-field-label" style="margin-bottom:6px;">Entities</div>`;
        html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">`;
        relatedEntities.forEach(ent => {{
          const eid = "entity-" + ent.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          html += `<button class="chip-btn chip-entity" onclick="openChipPanel('${{eid}}', 'entity')">${{ent.name}}</button>`;
        }});
        html += `</div>`;
      }}
      html += `</div>`;
    }}
  }}

  // LLM cost breakdown section
  if (llmMetrics && llmMetrics[d.id]) {{
    const m = llmMetrics[d.id];
    html += `<div class="panel-principles" style="margin-top:12px;padding-top:12px;border-top:1px solid #0f3460;">`;
    html += `<div class="panel-field-label" style="margin-bottom:8px;">LLM Cost</div>`;
    html += `<div style="display:flex;gap:12px;margin-bottom:8px;">`;
    // Mini stacked bar
    const maxBarW = 120;
    const totalCost = m.total_cost || 0.01;
    const designW = m.design ? (m.design.cost_usd / totalCost) * maxBarW : 0;
    const execW = m.execute ? (m.execute.cost_usd / totalCost) * maxBarW : 0;
    html += `<div style="display:flex;align-items:center;gap:4px;">`;
    html += `<div style="display:flex;height:12px;border-radius:3px;overflow:hidden;">`;
    if (designW > 0) html += `<div style="width:${{designW}}px;background:#ef6c00;"></div>`;
    if (execW > 0) html += `<div style="width:${{execW}}px;background:#00acc1;"></div>`;
    html += `</div>`;
    html += `<span style="color:#ffab40;font-weight:600;font-size:13px;">$${{totalCost.toFixed(2)}}</span>`;
    html += `</div></div>`;
    // Detail rows
    if (m.design) {{
      html += `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px;">`;
      html += `<span style="color:#ef6c00;">Design (${{m.design.model.replace("claude-", "")}})</span>`;
      html += `<span style="color:#aaa;">$${{m.design.cost_usd.toFixed(2)}} &middot; ${{m.design.num_turns}} turns &middot; ${{(m.design.duration_ms / 60000).toFixed(1)}}m</span>`;
      html += `</div>`;
    }}
    if (m.execute) {{
      html += `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px;">`;
      html += `<span style="color:#00acc1;">Execute (${{m.execute.model.replace("claude-", "")}})</span>`;
      html += `<span style="color:#aaa;">$${{m.execute.cost_usd.toFixed(2)}} &middot; ${{m.execute.num_turns}} turns &middot; ${{(m.execute.duration_ms / 60000).toFixed(1)}}m</span>`;
      html += `</div>`;
    }}
    html += `<div style="display:flex;justify-content:space-between;padding:6px 0 0;font-size:11px;border-top:1px solid #0f3460;margin-top:4px;">`;
    html += `<span style="color:#e0e0e0;">Total</span>`;
    html += `<span style="color:#e0e0e0;">${{m.total_turns}} turns &middot; ${{(m.total_duration_ms / 60000).toFixed(1)}} min</span>`;
    html += `</div>`;
    html += `</div>`;
  }}

  // Campaign provenance footer
  if (campaignContext && campaignContext.target_commit) {{
    html += `<div class="panel-principles" style="margin-top:12px;padding-top:12px;border-top:1px solid #0f3460;">`;
    html += `<div class="panel-field-label" style="margin-bottom:6px;">Campaign Provenance</div>`;
    const shortSha = campaignContext.target_commit.substring(0, 7);
    html += `<div style="font-size:11px;color:#888;">`;
    html += `<span title="${{campaignContext.target_commit}}">Target commit: <code style="background:#0a1628;padding:1px 5px;border-radius:3px;font-size:10px;color:#b39ddb;border:1px solid #1a2a4a;">${{shortSha}}</code></span>`;
    if (campaignContext.target_repo) html += ` <span style="color:#666;">(${{campaignContext.target_repo}})</span>`;
    html += `</div>`;
    if (campaignContext.started_at) {{
      const dt = new Date(campaignContext.started_at);
      html += `<div style="font-size:11px;color:#666;margin-top:4px;">Started: ${{dt.toLocaleDateString()}} ${{dt.toLocaleTimeString([], {{hour:"2-digit",minute:"2-digit"}})}}</div>`;
    }}
    html += `</div>`;
  }}

  content.innerHTML = html;
  panel.classList.add("open");
}}

function resetEdgeHighlights() {{
  d3.selectAll("line.link").each(function(d) {{
    const el = d3.select(this);
    if (d.type === "shared-principles") {{
      el.attr("stroke", "rgba(255,255,255,0.3)").attr("stroke-width", Math.min(d.weight || 1, 5)).attr("stroke-opacity", 0.6);
    }} else {{
      el.attr("stroke-opacity", 0.6).attr("stroke-width", 2);
    }}
  }});
}}

function closeIterPanel() {{
  document.getElementById("iter-detail-panel").classList.remove("open");
  resetEdgeHighlights();
}}

function openChipPanel(nodeId, nodeType, viewCtx) {{
  // Build a minimal node-like object to pass to showConceptPanel
  const fakeNode = {{ id: nodeId, nodeType: nodeType }};
  showConceptPanel(fakeNode, viewCtx || "iterations");
}}

function showPrinciplePanel(principleId) {{
  const panel = document.getElementById("iter-detail-panel");
  const content = document.getElementById("iter-detail-content");
  const princNodes = princData.nodes || [];
  const pNode = princNodes.find(n => n.id === principleId);
  if (!pNode) return;

  const confColors = {{ high: "#4caf50", medium: "#ff9800", low: "#f44336" }};
  const col = confColors[pNode.confidence] || "#666";

  let html = `<div class="panel-header">`;
  html += `<div class="outcome-dot" style="background:${{col}}"></div>`;
  html += `<h3>${{principleId}}</h3>`;
  html += `</div>`;
  html += `<div class="panel-outcome" style="color:${{col}}">${{(pNode.confidence || "unknown").toUpperCase()}} CONFIDENCE</div>`;
  html += `<div class="panel-field"><div class="panel-field-label">Statement</div><div class="panel-field-value">${{pNode.statement || "—"}}</div></div>`;
  if (pNode.regime) html += `<div class="panel-field"><div class="panel-field-label">When it applies</div><div class="panel-field-value">${{pNode.regime}}</div></div>`;
  if (pNode.mechanism) html += `<div class="panel-field"><div class="panel-field-label">Mechanism</div><div class="panel-field-value">${{pNode.mechanism}}</div></div>`;

  content.innerHTML = html;
  panel.classList.add("open");

  // Dim all edges, then highlight edges connecting nodes that share this principle
  d3.selectAll("line.link").each(function(link) {{
    const el = d3.select(this);
    const srcNode = (typeof link.source === "object") ? link.source : null;
    const tgtNode = (typeof link.target === "object") ? link.target : null;
    if (srcNode && tgtNode && srcNode.principles && tgtNode.principles &&
        srcNode.principles.includes(principleId) && tgtNode.principles.includes(principleId)) {{
      el.attr("stroke", "#fff").attr("stroke-width", 2.5).attr("stroke-opacity", 1);
    }} else {{
      el.attr("stroke-opacity", 0.1);
    }}
  }});
}}

function renderRelationshipChips(d, item, viewContext) {{
  let html = "";
  const ctx = viewContext;
  if (d.nodeType === "concept") {{
    const ownedParams = (item.parameters || []).map(pName =>
      (conceptsData.parameters || []).find(p => p.name === pName)).filter(Boolean);
    if (ownedParams.length > 0) {{
      html += `<div class="panel-field" style="margin-top:12px;padding-top:12px;border-top:1px solid #0f3460;"><div class="panel-field-label" style="margin-bottom:6px;">Parameters</div>`;
      html += `<div style="display:flex;flex-wrap:wrap;gap:6px;">`;
      ownedParams.forEach(p => {{
        const pid = "param-" + p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        html += `<button class="chip-btn chip-param" onclick="openChipPanel('${{pid}}', 'parameter', '${{ctx}}')">${{p.name}}</button>`;
      }});
      html += `</div></div>`;
    }}
    const operatesOn = (item.operates_on || []).map(eName =>
      (conceptsData.entities || []).find(e => e.name === eName)).filter(Boolean);
    if (operatesOn.length > 0) {{
      html += `<div class="panel-field" style="margin-top:12px;padding-top:12px;border-top:1px solid #0f3460;"><div class="panel-field-label" style="margin-bottom:6px;">Operates on</div>`;
      html += `<div style="display:flex;flex-wrap:wrap;gap:6px;">`;
      operatesOn.forEach(e => {{
        const eid = "entity-" + e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        html += `<button class="chip-btn chip-entity" onclick="openChipPanel('${{eid}}', 'entity', '${{ctx}}')">${{e.name}}</button>`;
      }});
      html += `</div></div>`;
    }}
  }} else if (d.nodeType === "parameter") {{
    const parentName = item.parent_concept;
    if (parentName) {{
      const parentConcept = (conceptsData.concepts || []).find(c => c.name === parentName);
      if (parentConcept) {{
        html += `<div class="panel-field" style="margin-top:12px;padding-top:12px;border-top:1px solid #0f3460;"><div class="panel-field-label" style="margin-bottom:6px;">Parent concept</div>`;
        const cid = "concept-" + parentConcept.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        html += `<button class="chip-btn chip-concept" onclick="openChipPanel('${{cid}}', 'concept', '${{ctx}}')">${{parentConcept.name}}</button>`;
        html += `</div>`;
      }}
    }}
  }} else if (d.nodeType === "entity") {{
    const actingConcepts = (conceptsData.concepts || []).filter(c =>
      (c.operates_on || []).includes(item.name));
    if (actingConcepts.length > 0) {{
      html += `<div class="panel-field" style="margin-top:12px;padding-top:12px;border-top:1px solid #0f3460;"><div class="panel-field-label" style="margin-bottom:6px;">Concepts that act on this</div>`;
      html += `<div style="display:flex;flex-wrap:wrap;gap:6px;">`;
      actingConcepts.forEach(c => {{
        const cid = "concept-" + c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        html += `<button class="chip-btn chip-concept" onclick="openChipPanel('${{cid}}', 'concept', '${{ctx}}')">${{c.name}}</button>`;
      }});
      html += `</div></div>`;
    }}
  }}
  return html;
}}

function showConceptPanel(d, viewContext) {{
  resetEdgeHighlights();
  const panel = document.getElementById("iter-detail-panel");
  const content = document.getElementById("iter-detail-content");
  const colorMap = {{ concept: "#5c6bc0", parameter: "#ce93d8", entity: "#66bb6a" }};
  const labelMap = {{ concept: "CONCEPT", parameter: "PARAMETER", entity: "ENTITY" }};
  const color = colorMap[d.nodeType] || "#9e9e9e";
  const typeLabel = labelMap[d.nodeType] || "UNKNOWN";
  const isKnowledge = viewContext === "knowledge";

  // Find the full data from conceptsData
  const sourceListMap = {{ concept: conceptsData.concepts || [], parameter: conceptsData.parameters || [], entity: conceptsData.entities || [] }};
  const prefixMap = {{ concept: "concept-", parameter: "param-", entity: "entity-" }};
  const sourceList = sourceListMap[d.nodeType] || [];
  const prefix = prefixMap[d.nodeType] || "";
  const item = sourceList.find(c => {{
    const id = prefix + c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return id === d.id;
  }});

  const displayName = d.label || (item && item.name) || d.id;
  let html = `<div class="panel-header">`;
  html += `<div class="outcome-dot" style="background:${{color}}"></div>`;
  html += `<h3>${{displayName}}</h3>`;
  html += `</div>`;
  html += `<div class="panel-outcome" style="color:${{color}}">${{typeLabel}}</div>`;

  if (item) {{
    // Definition
    html += `<div class="panel-field"><div class="panel-field-label">What it is</div><div class="panel-field-value">${{item.definition}}</div></div>`;

    // Render relationship chips (shared logic for both Knowledge and Iterations tabs)
    html += renderRelationshipChips(d, item, viewContext);

    if (isKnowledge) {{
      // Knowledge tab: show principles as clickable buttons for concepts
      if (d.nodeType === "concept") {{
        const princNodes = princData.nodes || [];
        const allPrincs = item.principles.map(pid => {{
          const pNode = princNodes.find(n => n.id === pid);
          return {{ id: pid, statement: pNode ? pNode.statement : null, confidence: pNode ? pNode.confidence : null }};
        }});
        if (allPrincs.length > 0) {{
          const confColors = {{ high: "#4caf50", medium: "#ff9800", low: "#f44336" }};
          html += `<div class="panel-field" style="margin-top:12px;padding-top:12px;border-top:1px solid #0f3460;"><div class="panel-field-label">Principles</div>`;
          html += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">`;
          allPrincs.forEach(p => {{
            const col = confColors[p.confidence] || "#666";
            html += `<button style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:600;color:${{col}};border:1px solid ${{col}};background:transparent;cursor:pointer;font-family:inherit;transition:all 0.15s;" onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='transparent'" onclick="showPrinciplePanel('${{p.id}}')">${{p.id}}</button>`;
          }});
          html += `</div></div>`;
        }}
      }}
      // Knowledge tab: show evolution timeline for parameters
      if (d.nodeType === "parameter") {{
        const evolution = item.evolution || [];
        if (evolution.length > 0) {{
          html += `<div class="panel-field" style="margin-top:12px;padding-top:12px;border-top:1px solid #0f3460;"><div class="panel-field-label">Value across iterations</div>`;
          const outcomeColors = {{ "confirmed": "#4caf50", "refuted": "#f44336", "partially_confirmed": "#ff9800", "baseline": "#9e9e9e" }};
          evolution.forEach(ev => {{
            const oc = outcomeColors[(ev.outcome || "").toLowerCase()] || "#9e9e9e";
            html += `<div style="margin:6px 0;border-left:3px solid ${{oc}};padding-left:8px;"><span style="color:#ccc;font-weight:600;font-size:11px;">${{ev.iter}}</span> <span style="color:#7986cb;font-size:11px;">= ${{ev.value}}</span><br><span style="color:#999;font-size:10px;">${{ev.note || ""}}</span></div>`;
          }});
          html += `</div>`;
        }}
      }}
    }} else {{
      // Which iterations involve this item
      const iterNodes = iterData.nodes.filter(n => n.nodeType === "iteration");
      const connectedIters = iterNodes.filter(iterNode => {{
        const iterPrinciples = iterNode.principles || [];
        return item.principles.some(pid => iterPrinciples.includes(pid));
      }});
      if (connectedIters.length > 0) {{
        html += `<div class="panel-field" style="margin-top:12px;padding-top:12px;border-top:1px solid #0f3460;"><div class="panel-field-label" style="margin-bottom:6px;">Appears in iterations</div>`;
        html += `<div style="display:flex;flex-wrap:wrap;gap:6px;">`;
        connectedIters.forEach(iter => {{
          const colorMap = {{ "CONFIRMED": "#4caf50", "REFUTED": "#f44336", "PARTIALLY_CONFIRMED": "#ff9800", "BASELINE": "#9e9e9e" }};
          const c = colorMap[iter.outcome] || "#9e9e9e";
          html += `<button class="chip-btn" style="color:${{c}};border-color:${{c}};" onclick="showIterPanel(iterData.nodes.find(n=>n.id==='${{iter.id}}'))">${{iter.label}}</button>`;
        }});
        html += `</div></div>`;
      }}
    }}
  }}

  content.innerHTML = html;
  panel.classList.add("open");
}}

function switchInsightTab(idx) {{
  document.querySelectorAll(".insights-nav-btn").forEach(btn => {{
    btn.classList.remove("active");
    btn.style.color = "";
  }});
  const activeBtn = document.querySelector(`.insights-nav-btn[data-idx="${{idx}}"]`);
  activeBtn.classList.add("active");
  activeBtn.style.color = activeBtn.dataset.color;
  document.querySelectorAll(".insights-section").forEach(s => s.classList.remove("active"));
  document.querySelector(`.insights-section[data-section="${{idx}}"]`).classList.add("active");
}}

function render(data, viewType) {{
  // Clear existing
  d3.select("body > svg").remove();
  if (simulation) simulation.stop();

  const width = window.innerWidth;
  const height = window.innerHeight;

  svg = d3.select("body").append("svg")
    .attr("viewBox", [0, 0, width, height])
    .call(d3.zoom().on("zoom", (e) => g.attr("transform", e.transform)))
    .on("click", (e) => {{
      if (e.target.tagName === "svg") {{ resetEdgeHighlights(); }}
    }});

  g = svg.append("g");

  let nodes = data.nodes.map(d => ({{...d}}));
  let links = data.links.map(d => ({{...d}}));

  // In principles view: use pre-computed knowledge graph from Python
  if (viewType === "principles" && knowledgeGraph && knowledgeGraph.nodes.length > 0) {{
    // Clear all principle nodes and links — use pre-computed concept/entity graph
    nodes = [];
    links = [];

    // Map pre-computed nodes
    knowledgeGraph.nodes.forEach(n => {{
      const sharedCount = knowledgeGraph.edges.filter(e => e.source === n.id || e.target === n.id).length;
      const radius = Math.min(8 + sharedCount * 1.5, 18);
      nodes.push({{
        id: n.id, label: n.name, nodeType: n.type,
        tooltip: `<strong>${{n.name}}</strong><br>${{n.definition}}<br><br><em>${{n.principles.length}} principles</em>`,
        radius, principles: n.principles, definition: n.definition
      }});
    }});

    // Map pre-computed edges
    knowledgeGraph.edges.forEach(e => {{
      links.push({{ source: e.source, target: e.target, type: "shared-principles", weight: e.shared_principles.length }});
    }});
  }}

  // Inject concept/entity sub-nodes for iterations view (replaces principle sub-nodes)
  if (viewType === "iterations" && conceptsData) {{
    // Remove principle sub-nodes — concepts/entities replace them
    nodes = nodes.filter(n => n.nodeType !== "principle");
    links = links.filter(l => l.type !== "principle-of");

    // Helper: check if a concept/entity name is mentioned in an iteration's summary
    function summaryMentions(iterNode, name) {{
      const summary = iterSummaries[iterNode.id];
      if (!summary) return false;
      const text = [summary.what_was_tried || "", summary.what_was_found || "", summary.why_it_matters || ""].join(" ").toLowerCase();
      // Extract search terms: full name + each word/abbreviation before parentheses
      const terms = [name.toLowerCase()];
      const parenMatch = name.match(/^([^(]+)\s*\(/);
      if (parenMatch) terms.push(parenMatch[1].trim().toLowerCase());
      const abbrevMatch = name.match(/\(([^)]+)\)/);
      if (abbrevMatch) terms.push(abbrevMatch[1].trim().toLowerCase());
      return terms.some(term => text.includes(term));
    }}

    // Helper: check if iteration is connected to a concept/entity
    function iterConnected(iterNode, item) {{
      const iterPrinciples = iterNode.principles || [];
      return item.principles.some(pid => iterPrinciples.includes(pid)) || summaryMentions(iterNode, item.name);
    }}

    // Shared concept/parameter/entity nodes — only add if linked to at least one iteration
    const iterNodes = nodes.filter(n => n.nodeType === "iteration");

    (conceptsData.concepts || []).forEach(c => {{
      const id = "concept-" + c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const connectedIters = iterNodes.filter(iterNode => iterConnected(iterNode, c));
      if (connectedIters.length > 0) {{
        nodes.push({{ id, label: c.name, nodeType: "concept",
          tooltip: `<strong>${{c.name}}</strong><br>${{c.definition}}` }});
        connectedIters.forEach(iterNode => {{
          links.push({{ source: iterNode.id, target: id, type: "concept-of" }});
        }});
      }}
    }});

    (conceptsData.parameters || []).forEach(p => {{
      const id = "param-" + p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const connectedIters = iterNodes.filter(iterNode => iterConnected(iterNode, p));
      if (connectedIters.length > 0) {{
        nodes.push({{ id, label: p.name, nodeType: "parameter",
          tooltip: `<strong>${{p.name}}</strong><br>${{p.definition}}` }});
        connectedIters.forEach(iterNode => {{
          links.push({{ source: iterNode.id, target: id, type: "concept-of" }});
        }});
      }}
    }});

    (conceptsData.entities || []).forEach(ent => {{
      const id = "entity-" + ent.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const connectedIters = iterNodes.filter(iterNode => iterConnected(iterNode, ent));
      if (connectedIters.length > 0) {{
        nodes.push({{ id, label: ent.name, nodeType: "entity",
          tooltip: `<strong>${{ent.name}}</strong><br>${{ent.definition}}` }});
        connectedIters.forEach(iterNode => {{
          links.push({{ source: iterNode.id, target: id, type: "concept-of" }});
        }});
      }}
    }});
  }}

  simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(d => {{
      if (viewType === "iterations") return (d.type === "principle-of" || d.type === "concept-of") ? 40 : 280;
      if (viewType === "principles") return d.weight ? Math.max(80, 200 / d.weight) : 140;
      return 80;
    }}))
    .force("charge", d3.forceManyBody().strength(d => {{
      if (viewType === "iterations") return (d.nodeType === "principle" || d.nodeType === "concept" || d.nodeType === "entity" || d.nodeType === "parameter") ? -15 : -600;
      if (viewType === "principles") return -400;
      return -80;
    }}))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("x", viewType === "principles" ? d3.forceX(width / 2).strength(0.08) : null)
    .force("y", viewType === "principles" ? d3.forceY(height / 2).strength(0.08) : null)
    .force("collision", d3.forceCollide().radius(d => {{
      if (viewType === "iterations") return (d.nodeType === "principle" || d.nodeType === "concept" || d.nodeType === "entity") ? 18 : 50;
      if (viewType === "principles") return (d.radius || 16) + 8;
      return (d.radius || 14) + 4;
    }}));

  const link = g.append("g").selectAll("line")
    .data(links)
    .join("line")
    .attr("class", d => {{
      if (viewType === "iterations" && (d.type === "principle-of" || d.type === "concept-of")) return "principle-link link";
      return "link";
    }})
    .attr("stroke", d => {{
      if (viewType === "iterations") {{
        if (d.type === "led-to") return "#555";
        if (d.type === "concept-of") return "#5c6bc0";
        return "#7c4dff";
      }} else {{
        if (d.type === "shared-principles") return "rgba(255,255,255,0.3)";
        if (d.type === "contradicts") return "#f44336";
        if (d.type === "supersedes") return "#ff9800";
        if (d.type === "co-extracted") return "rgba(255,255,255,0.08)";
        if (d.type === "concept-link") return "rgba(92,107,192,0.4)";
        return "#555";
      }}
    }})
    .attr("stroke-width", d => {{
      if (d.type === "principle-of" || d.type === "extracted-from") return 1;
      if (d.type === "shared-principles") return Math.min(d.weight || 1, 5);
      return 2;
    }})
    .attr("stroke-dasharray", d => {{
      if (d.type === "led-to" || d.type === "supersedes") return "4,4";
      return null;
    }})
    .attr("stroke-opacity", d => {{
      if (viewType === "iterations" && (d.type === "principle-of" || d.type === "concept-of")) return 0;
      return 0.6;
    }});

  const node = g.append("g").selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", d => {{
      if (viewType === "iterations") {{
        if (d.nodeType === "principle" || d.nodeType === "concept" || d.nodeType === "parameter" || d.nodeType === "entity") return "principle-node";
        return "iteration-node";
      }}
      return "iteration-node";
    }})
    .call(d3.drag()
      .on("start", (e, d) => {{ if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }})
      .on("drag", (e, d) => {{ d.fx = e.x; d.fy = e.y; }})
      .on("end", (e, d) => {{ if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }}));

  if (viewType === "iterations") {{
    // Iteration view rendering
    const iterColorMap = {{ "CONFIRMED": "#4caf50", "REFUTED": "#f44336", "PARTIALLY_CONFIRMED": "#ff9800", "BASELINE": "#9e9e9e" }};

    node.filter(d => d.nodeType === "iteration")
      .append("circle")
      .attr("r", 20)
      .attr("fill", d => iterColorMap[d.outcome] || "#9e9e9e")
      .attr("stroke", "#fff")
      .attr("stroke-width", 2);

    node.filter(d => d.nodeType === "principle")
      .append("circle")
      .attr("r", 6)
      .attr("fill", "#7c4dff")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1);

    node.filter(d => d.nodeType === "principle")
      .append("text")
      .attr("class", "label")
      .attr("dy", 16)
      .style("font-size", "9px")
      .text(d => d.label);

    // Concept sub-nodes (small squares) in iterations view — no labels, tooltip only
    node.filter(d => d.nodeType === "concept")
      .style("cursor", "pointer")
      .append("rect")
      .attr("width", 14).attr("height", 14)
      .attr("x", -7).attr("y", -7)
      .attr("rx", 3).attr("ry", 3)
      .attr("fill", "#1a237e")
      .attr("stroke", "#5c6bc0")
      .attr("stroke-width", 1.5);

    // Parameter sub-nodes (small triangles) in iterations view — no labels, tooltip only
    node.filter(d => d.nodeType === "parameter")
      .style("cursor", "pointer")
      .append("polygon")
      .attr("points", "0,-8 7,6 -7,6")
      .attr("fill", "#4a148c")
      .attr("stroke", "#ce93d8")
      .attr("stroke-width", 1.5);

    // Entity sub-nodes (small diamonds) in iterations view — no labels, tooltip only
    node.filter(d => d.nodeType === "entity")
      .style("cursor", "pointer")
      .append("polygon")
      .attr("points", "-7,0 0,-7 7,0 0,7")
      .attr("fill", "#1b5e20")
      .attr("stroke", "#66bb6a")
      .attr("stroke-width", 1.5);

    // Cost bars to the right of iteration nodes (stacked: design=blue, execute=green)
    if (llmMetrics && Object.keys(llmMetrics).length > 0) {{
      const maxCost = Math.max(...Object.values(llmMetrics).map(m => m.total_cost || 0));
      const barMaxHeight = 30;
      const barWidth = 6;

      const iterCostGroup = node.filter(d => d.nodeType === "iteration" && llmMetrics[d.id])
        .append("g")
        .attr("class", "cost-bar")
        .attr("transform", `translate(24, -${{barMaxHeight / 2}})`);

      // Design phase bar (blue) - top portion
      iterCostGroup.append("rect")
        .attr("width", barWidth)
        .attr("height", d => {{
          const m = llmMetrics[d.id];
          return m.design ? (m.design.cost_usd / maxCost) * barMaxHeight : 0;
        }})
        .attr("y", d => {{
          const m = llmMetrics[d.id];
          const designH = m.design ? (m.design.cost_usd / maxCost) * barMaxHeight : 0;
          const execH = m.execute ? (m.execute.cost_usd / maxCost) * barMaxHeight : 0;
          return barMaxHeight - designH - execH;
        }})
        .attr("rx", 1)
        .attr("fill", "#ef6c00")
        .attr("opacity", 0.85);

      // Execute phase bar (cyan) - bottom portion
      iterCostGroup.append("rect")
        .attr("width", barWidth)
        .attr("height", d => {{
          const m = llmMetrics[d.id];
          return m.execute ? (m.execute.cost_usd / maxCost) * barMaxHeight : 0;
        }})
        .attr("y", d => {{
          const m = llmMetrics[d.id];
          const execH = m.execute ? (m.execute.cost_usd / maxCost) * barMaxHeight : 0;
          return barMaxHeight - execH;
        }})
        .attr("rx", 1)
        .attr("fill", "#00acc1")
        .attr("opacity", 0.85);
    }}

    node.filter(d => d.nodeType === "iteration")
      .append("text")
      .attr("class", "label")
      .attr("dy", 35)
      .text(d => d.label);
  }} else {{
    // Principles view — concept/entity knowledge graph
    // Truncate labels: use abbreviation if present, otherwise shorten
    function shortLabel(name, max) {{
      const abbrev = name.match(/\(([^)]+)\)/);
      if (abbrev && abbrev[1].length <= max) return abbrev[1];
      const base = name.replace(/\s*\([^)]*\)\s*/g, "").trim();
      return base.length <= max ? base : base.slice(0, max - 1) + "\u2026";
    }}

    node.filter(d => d.nodeType === "concept")
      .style("cursor", "pointer")
      .append("rect")
      .attr("width", d => Math.max(d.radius * 2, 32))
      .attr("height", d => Math.max(d.radius * 2, 32))
      .attr("x", d => -Math.max(d.radius, 16))
      .attr("y", d => -Math.max(d.radius, 16))
      .attr("rx", 6).attr("ry", 6)
      .attr("fill", "#1a237e")
      .attr("stroke", "#5c6bc0")
      .attr("stroke-width", 2);

    node.filter(d => d.nodeType === "concept")
      .append("text")
      .attr("class", "label")
      .attr("dy", d => Math.max(d.radius, 16) + 14)
      .style("fill", "#9fa8da")
      .style("font-weight", "600")
      .style("font-size", "10px")
      .text(d => shortLabel(d.label, 18));

    node.filter(d => d.nodeType === "entity")
      .style("cursor", "pointer")
      .append("polygon")
      .attr("points", d => {{
        const r = Math.max(d.radius, 16);
        return `-${{r}},0 0,-${{r}} ${{r}},0 0,${{r}}`;
      }})
      .attr("fill", "#1b5e20")
      .attr("stroke", "#66bb6a")
      .attr("stroke-width", 2);

    node.filter(d => d.nodeType === "entity")
      .append("text")
      .attr("class", "label")
      .attr("dy", d => Math.max(d.radius, 16) + 14)
      .style("fill", "#a5d6a7")
      .style("font-weight", "600")
      .style("font-size", "10px")
      .text(d => shortLabel(d.label, 18));

    // Parameter nodes (triangles, smaller) in knowledge graph
    node.filter(d => d.nodeType === "parameter")
      .style("cursor", "pointer")
      .append("polygon")
      .attr("points", d => {{
        const r = Math.max(d.radius * 0.6, 10);
        return `0,-${{r}} ${{r}},${{r * 0.75}} -${{r}},${{r * 0.75}}`;
      }})
      .attr("fill", "#4a148c")
      .attr("stroke", "#ce93d8")
      .attr("stroke-width", 1.5);

    node.filter(d => d.nodeType === "parameter")
      .append("text")
      .attr("class", "label")
      .attr("dy", d => Math.max(d.radius * 0.6, 10) + 12)
      .style("fill", "#ce93d8")
      .style("font-weight", "600")
      .style("font-size", "9px")
      .text(d => shortLabel(d.label, 16));
  }}

  // Tooltip
  const tooltip = d3.select("#tooltip");
  node.on("mouseover", (e, d) => {{
    let html = d.tooltip;
    // Enrich iteration tooltips with cost data
    if (d.nodeType === "iteration" && llmMetrics && llmMetrics[d.id]) {{
      const m = llmMetrics[d.id];
      html += `<br><hr style="border-color:#0f3460;margin:6px 0;">`;
      html += `<span style="color:#ffab40;">Cost: $$${{m.total_cost.toFixed(2)}}</span>`;
      if (m.design) html += `<br><span style="color:#ef6c00;">Design:</span> $$${{m.design.cost_usd.toFixed(2)}} (${{m.design.model.replace("claude-", "")}}, ${{m.design.num_turns}} turns)`;
      if (m.execute) html += `<br><span style="color:#00acc1;">Execute:</span> $$${{m.execute.cost_usd.toFixed(2)}} (${{m.execute.model.replace("claude-", "")}}, ${{m.execute.num_turns}} turns)`;
      const durationMin = (m.total_duration_ms / 60000).toFixed(1);
      html += `<br>Duration: ${{durationMin}} min`;
    }}
    tooltip.style("display", "block")
      .html(html)
      .style("left", (e.pageX + 12) + "px")
      .style("top", (e.pageY - 12) + "px");
  }})
  .on("mouseout", () => tooltip.style("display", "none"));

  // Click to show detail panel + expand sub-nodes (iterations view only)
  if (viewType === "iterations") {{
    node.filter(d => d.nodeType === "iteration")
      .on("click", (e, d) => {{
        if (conceptsData) {{
          // Hide all concept/entity nodes and links first
          g.selectAll("g.principle-node").classed("visible", false);
          link.filter(l => l.type === "concept-of").classed("visible", false);

          // Show only the ones for this iteration (unless clicking the same node again)
          const relevantIds = new Set();
          (conceptsData.concepts || []).forEach(c => {{
            if (iterConnected(d, c)) {{
              relevantIds.add("concept-" + c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
            }}
          }});
          (conceptsData.parameters || []).forEach(p => {{
            if (iterConnected(d, p)) {{
              relevantIds.add("param-" + p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
            }}
          }});
          (conceptsData.entities || []).forEach(ent => {{
            if (iterConnected(d, ent)) {{
              relevantIds.add("entity-" + ent.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
            }}
          }});

          if (d._lastClicked) {{
            // Clicking same node again — hide (already hidden above)
            d._lastClicked = false;
          }} else {{
            // Clear flag on all nodes, set on this one
            nodes.forEach(n => n._lastClicked = false);
            d._lastClicked = true;
            g.selectAll("g.principle-node")
              .filter(p => relevantIds.has(p.id))
              .classed("visible", true);
            link.filter(l => l.type === "concept-of" && l.source.id === d.id)
              .classed("visible", true);
          }}
        }} else {{
          // Fallback: show principle sub-nodes
          const principleIds = links
            .filter(l => l.type === "principle-of" && l.source.id === d.id)
            .map(l => l.target.id);
          const pNodes = g.selectAll("g.principle-node")
            .filter(p => principleIds.includes(p.id));
          const isVisible = pNodes.classed("visible");
          pNodes.classed("visible", !isVisible);
          link.filter(l => l.type === "principle-of" && l.source.id === d.id)
            .classed("visible", !isVisible);
        }}
        // Show detail panel
        showIterPanel(d);
      }});

    // Click concept/parameter/entity sub-nodes to show their detail panel (iterations context)
    node.filter(d => d.nodeType === "concept" || d.nodeType === "parameter" || d.nodeType === "entity")
      .on("click", (e, d) => {{
        showConceptPanel(d, "iterations");
      }});
  }}

  // Click handler for principles (knowledge graph) view
  if (viewType === "principles") {{
    node.on("click", (e, d) => {{
      showConceptPanel(d, "knowledge");
    }});
  }}

  // Compute and draw permanent revisit arcs for iterations view
  let revisitArcsData = [];
  if (viewType === "iterations" && conceptsData) {{
    const iterNodesOnly = nodes.filter(n => n.nodeType === "iteration")
      .sort((a, b) => parseInt(a.id.replace("iter-", "")) - parseInt(b.id.replace("iter-", "")));
    // For each iteration, find which sub-node IDs it connects to
    const iterSubMap = {{}};
    links.forEach(l => {{
      if (l.type === "concept-of") {{
        const srcId = (typeof l.source === "object") ? l.source.id : l.source;
        const tgtId = (typeof l.target === "object") ? l.target.id : l.target;
        if (!iterSubMap[srcId]) iterSubMap[srcId] = new Set();
        iterSubMap[srcId].add(tgtId);
      }}
    }});
    // Find revisit pairs: iter-N shares 2+ concepts with iter-M (M < N-1)
    // Only keep the strongest match per iteration (most shared concepts)
    for (let n = 2; n < iterNodesOnly.length; n++) {{
      const curId = iterNodesOnly[n].id;
      const curSubs = iterSubMap[curId] || new Set();
      if (curSubs.size === 0) continue;
      const prevSubs = iterSubMap[iterNodesOnly[n - 1].id] || new Set();
      let bestMatch = null;
      for (let m = 0; m < n - 1; m++) {{
        const earlierId = iterNodesOnly[m].id;
        const earlierSubs = iterSubMap[earlierId] || new Set();
        let shared = 0;
        curSubs.forEach(s => {{ if (earlierSubs.has(s)) shared++; }});
        if (shared >= 2) {{
          let prevShared = 0;
          curSubs.forEach(s => {{ if (prevSubs.has(s)) prevShared++; }});
          if (shared > prevShared && (!bestMatch || shared > bestMatch.shared)) {{
            bestMatch = {{ fromId: earlierId, toId: curId, shared: shared }};
          }}
        }}
      }}
      if (bestMatch) revisitArcsData.push(bestMatch);
    }}
  }}

  // Draw revisit arcs as SVG paths (start hidden, fade in after simulation settles)
  const revisitPaths = g.append("g").attr("class", "revisit-arcs-permanent")
    .selectAll("path")
    .data(revisitArcsData)
    .join("path")
    .attr("class", "revisit-arc")
    .attr("stroke", "#ffb74d")
    .attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "6,3")
    .attr("opacity", 0)
    .attr("fill", "none");

  let tickCount = 0;
  simulation.on("tick", () => {{
    tickCount++;
    link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    node.attr("transform", d => `translate(${{d.x}},${{d.y}})`);
    // Update revisit arc paths every tick
    if (revisitArcsData.length > 0) {{
      revisitPaths.attr("d", arc => {{
        const fromNode = nodes.find(n => n.id === arc.fromId);
        const toNode = nodes.find(n => n.id === arc.toId);
        if (!fromNode || !toNode) return "";
        const midX = (fromNode.x + toNode.x) / 2;
        const midY = Math.min(fromNode.y, toNode.y) - 60 - arc.shared * 10;
        return `M${{fromNode.x}},${{fromNode.y}} Q${{midX}},${{midY}} ${{toNode.x}},${{toNode.y}}`;
      }});
      // Fade in arcs after layout stabilizes (~120 ticks), and only when not in timeline mode
      if (tickCount === 120) {{
        revisitPaths.transition().duration(800)
          .attr("opacity", d => timelineActive ? 0 : 0.5);
      }}
    }}
  }});
}}

// --- Timeline animation ---
let timelineActive = false;
let timelinePlaying = false;
let timelineInterval = null;
let timelineStep = 0;
let timelineMaxSteps = 0;

function getIterationNodes() {{
  return iterData.nodes.filter(n => n.nodeType === "iteration")
    .sort((a, b) => {{
      const numA = parseInt(a.id.replace("iter-", ""));
      const numB = parseInt(b.id.replace("iter-", ""));
      return numA - numB;
    }});
}}

function startTimeline() {{
  if (currentView !== "iterations") return;
  const iterNodes = getIterationNodes();
  timelineMaxSteps = iterNodes.length - 1;
  if (timelineMaxSteps < 1) return;

  timelineActive = true;
  timelineStep = 0;
  timelinePlaying = true;

  const slider = document.getElementById("timeline-slider");
  slider.max = timelineMaxSteps;
  slider.value = 0;

  document.getElementById("timeline-trigger").classList.remove("visible");
  document.getElementById("timeline-controls").classList.add("visible");
  document.getElementById("timeline-play-btn").innerHTML = "&#9646;&#9646;";

  applyTimelineFilter(0);
  timelineInterval = setInterval(() => {{
    if (timelineStep < timelineMaxSteps) {{
      timelineStep++;
      document.getElementById("timeline-slider").value = timelineStep;
      applyTimelineFilter(timelineStep);
    }} else {{
      pauseTimeline();
    }}
  }}, 1500);
}}

function toggleTimelinePlay() {{
  if (timelinePlaying) {{
    pauseTimeline();
  }} else {{
    resumeTimeline();
  }}
}}

function pauseTimeline() {{
  timelinePlaying = false;
  if (timelineInterval) clearInterval(timelineInterval);
  timelineInterval = null;
  document.getElementById("timeline-play-btn").innerHTML = "&#9654;";
}}

function resumeTimeline() {{
  if (timelineStep >= timelineMaxSteps) timelineStep = 0;
  timelinePlaying = true;
  document.getElementById("timeline-play-btn").innerHTML = "&#9646;&#9646;";
  timelineInterval = setInterval(() => {{
    if (timelineStep < timelineMaxSteps) {{
      timelineStep++;
      document.getElementById("timeline-slider").value = timelineStep;
      applyTimelineFilter(timelineStep);
    }} else {{
      pauseTimeline();
    }}
  }}, 1500);
}}

function scrubTimeline(val) {{
  timelineStep = parseInt(val);
  applyTimelineFilter(timelineStep);
  if (timelinePlaying) pauseTimeline();
}}

function dismissTimeline() {{
  pauseTimeline();
  timelineActive = false;
  document.getElementById("timeline-controls").classList.remove("visible");
  document.getElementById("timeline-trigger").classList.add("visible");
  document.getElementById("timeline-narrative").classList.remove("visible");
  // Restore full visibility
  d3.selectAll("g.iteration-node, g.principle-node").style("opacity", null).style("pointer-events", null);
  d3.selectAll("line.link").style("opacity", null);
  // Remove animation-only revisit arcs and restore permanent ones
  d3.selectAll(".revisit-arc-anim").remove();
  d3.selectAll(".revisit-arcs-permanent path").transition().duration(400).attr("opacity", 0.5);
}}

function computeRevisitArcs(step, iterNodes) {{
  // A "revisit" is when iter-N shares concept sub-nodes with iter-M (M < N-1)
  // indicating the researcher went back to an earlier idea
  const arcs = [];
  if (step < 2) return arcs;
  const currentId = iterNodes[step].id;
  // Get concept-of links from the current iteration
  const currentSubIds = new Set();
  d3.selectAll("line.link").each(function(l) {{
    const srcId = (typeof l.source === "object") ? l.source.id : l.source;
    const tgtId = (typeof l.target === "object") ? l.target.id : l.target;
    if (l.type === "concept-of" && srcId === currentId) currentSubIds.add(tgtId);
  }});
  if (currentSubIds.size === 0) return arcs;
  // Check earlier non-adjacent iterations (skip step-1, that's sequential)
  for (let i = 0; i < step - 1; i++) {{
    const earlierId = iterNodes[i].id;
    let shared = 0;
    d3.selectAll("line.link").each(function(l) {{
      const srcId = (typeof l.source === "object") ? l.source.id : l.source;
      const tgtId = (typeof l.target === "object") ? l.target.id : l.target;
      if (l.type === "concept-of" && srcId === earlierId && currentSubIds.has(tgtId)) shared++;
    }});
    // Only show if significant overlap (2+ shared concepts) and the immediately
    // previous iteration does NOT share those same concepts (true revisit)
    if (shared >= 2) {{
      const prevId = iterNodes[step - 1].id;
      let prevShared = 0;
      d3.selectAll("line.link").each(function(l) {{
        const srcId = (typeof l.source === "object") ? l.source.id : l.source;
        const tgtId = (typeof l.target === "object") ? l.target.id : l.target;
        if (l.type === "concept-of" && srcId === prevId && currentSubIds.has(tgtId)) prevShared++;
      }});
      if (shared > prevShared) {{
        arcs.push({{ from: earlierId, to: currentId, shared: shared }});
      }}
    }}
  }}
  return arcs;
}}

function drawRevisitArcs(arcs) {{
  // Remove old animation-only arcs (not permanent ones)
  d3.selectAll(".revisit-arc-anim").remove();
  if (!g || arcs.length === 0) return;
  // Draw curved arcs between non-adjacent iterations
  const arcGroup = g.append("g").attr("class", "revisit-arc-anim");
  arcs.forEach(arc => {{
    // Find node positions from the simulation
    const fromNode = d3.selectAll("g.iteration-node").filter(d => d.id === arc.from).datum();
    const toNode = d3.selectAll("g.iteration-node").filter(d => d.id === arc.to).datum();
    if (!fromNode || !toNode) return;
    // Draw a quadratic bezier arc above the nodes
    const midX = (fromNode.x + toNode.x) / 2;
    const midY = Math.min(fromNode.y, toNode.y) - 80;
    const pathD = `M${{fromNode.x}},${{fromNode.y}} Q${{midX}},${{midY}} ${{toNode.x}},${{toNode.y}}`;
    arcGroup.append("path")
      .attr("d", pathD)
      .attr("stroke", "#ffb74d")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "6,3")
      .attr("fill", "none")
      .attr("opacity", 0)
      .transition().duration(600)
      .attr("opacity", 0.8);
  }});
}}

function applyTimelineFilter(step) {{
  const iterNodes = getIterationNodes();
  const currentIterId = iterNodes[step].id;
  const visibleIterIds = new Set(iterNodes.slice(0, step + 1).map(n => n.id));

  document.getElementById("timeline-label").textContent =
    iterNodes[step].label + " / " + iterNodes[iterNodes.length - 1].label;

  // --- Narrative annotation ---
  const narrative = narrativesData[currentIterId];
  const summary = iterSummaries[currentIterId];
  const narrEl = document.getElementById("timeline-narrative");
  const narrText = summary ? summary.what_was_tried : (narrative ? narrative.title : "");
  if (narrText) {{
    const curOutcome = iterNodes[step].outcome;
    const outcomeColors = {{ "CONFIRMED": "#4caf50", "REFUTED": "#f44336", "PARTIALLY_CONFIRMED": "#ff9800" }};
    const borderColor = outcomeColors[curOutcome] || "#0f3460";
    // Preamble: why this iteration exists (based on previous outcome)
    let preamble = "";
    if (step > 0) {{
      const prevOutcome = iterNodes[step - 1].outcome;
      if (prevOutcome === "CONFIRMED") preamble = "Built on success";
      else if (prevOutcome === "REFUTED") preamble = "Pivoted after failure";
      else if (prevOutcome === "PARTIALLY_CONFIRMED") preamble = "Refined partial result";
    }}
    let narrHtml = `<div style="font-size:9px;color:${{borderColor}};font-weight:600;margin-bottom:4px;">${{iterNodes[step].label}}${{preamble ? " — " + preamble : ""}}</div>`;
    narrHtml += `<div class="narr-title" style="border-left:3px solid ${{borderColor}};padding-left:8px;">${{narrText}}</div>`;
    narrEl.innerHTML = narrHtml;
    narrEl.classList.add("visible");
  }} else {{
    narrEl.classList.remove("visible");
  }}

  // Permanent revisit arcs are shown/hidden at the end of this function

  // --- Node/edge visibility ---
  // Determine visible sub-node IDs: those connected to a visible iteration
  const visibleSubIds = new Set();
  d3.selectAll("line.link").each(function(l) {{
    const srcId = (typeof l.source === "object") ? l.source.id : l.source;
    const tgtId = (typeof l.target === "object") ? l.target.id : l.target;
    if (l.type === "concept-of" && visibleIterIds.has(srcId)) {{
      visibleSubIds.add(tgtId);
    }}
  }});

  // Apply visibility to iteration nodes
  d3.selectAll("g.iteration-node").each(function(d) {{
    const visible = visibleIterIds.has(d.id);
    d3.select(this)
      .transition().duration(400)
      .style("opacity", visible ? 1 : 0.08)
      .style("pointer-events", visible ? "all" : "none");
  }});

  // Apply visibility to sub-nodes (concepts, params, entities)
  d3.selectAll("g.principle-node").each(function(d) {{
    const visible = visibleSubIds.has(d.id);
    d3.select(this)
      .transition().duration(400)
      .style("opacity", visible ? 0.9 : 0.05)
      .style("pointer-events", visible ? "all" : "none");
  }});

  // Apply visibility to edges
  d3.selectAll("line.link").each(function(l) {{
    const srcId = (typeof l.source === "object") ? l.source.id : l.source;
    const tgtId = (typeof l.target === "object") ? l.target.id : l.target;
    let visible = false;
    if (l.type === "led-to") {{
      visible = visibleIterIds.has(srcId) && visibleIterIds.has(tgtId);
    }} else if (l.type === "concept-of") {{
      visible = visibleIterIds.has(srcId) && visibleSubIds.has(tgtId);
    }} else {{
      visible = visibleIterIds.has(srcId) || visibleIterIds.has(tgtId);
    }}
    d3.select(this)
      .transition().duration(400)
      .style("opacity", visible ? null : 0.05);
  }});

  // Hide/show permanent revisit arcs based on endpoint visibility
  d3.selectAll(".revisit-arcs-permanent path").each(function() {{
    const d = d3.select(this).datum();
    const bothVisible = visibleIterIds.has(d.fromId) && visibleIterIds.has(d.toId);
    d3.select(this).transition().duration(400).attr("opacity", bothVisible ? 0.5 : 0);
  }});
}}

// Initial render
render(iterData, "iterations");
renderCostChart();

// Show timeline trigger if there are at least 2 iterations
if (getIterationNodes().length >= 2) {{
  document.getElementById("timeline-trigger").classList.add("visible");
}}
</script>
</body>
</html>"""


def load_campaign(campaign_path: Path):
    """Load ledger.json and principles.json from campaign directory."""
    ledger_path = campaign_path / "ledger.json"
    principles_path = campaign_path / "principles.json"

    if not ledger_path.exists():
        sys.exit(f"Error: {ledger_path} not found")
    if not principles_path.exists():
        sys.exit(f"Error: {principles_path} not found")

    with open(ledger_path) as f:
        ledger = json.load(f)
    with open(principles_path) as f:
        principles = json.load(f)

    return ledger, principles


def load_llm_metrics(campaign_path: Path, ledger: dict) -> dict:
    """Load LLM cost metrics from llm_metrics.jsonl and group by iteration.

    Returns a dict keyed by iteration ID (e.g., "iter-1") with cost breakdowns.
    Each iteration has two phases: design (planner) and execute-analyze (executor).
    Handles retries correctly by assigning entries to iterations based on
    timestamps rather than assuming strict design/execute pairs.
    """
    metrics_path = campaign_path / "llm_metrics.jsonl"
    if not metrics_path.exists():
        return {}

    entries = []
    with open(metrics_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    if not entries:
        return {}

    iterations = ledger.get("iterations", [])
    result = {}

    # Include all iterations with a timestamp (excludes only baseline iter-0).
    # FAILED iterations are included so their costs aren't misattributed to neighbors.
    non_baseline = [
        it for it in iterations
        if isinstance(it.get("iteration"), int) and it["iteration"] > 0 and it.get("timestamp")
    ]
    if not non_baseline:
        return {}

    def parse_ts(ts_str):
        if not ts_str:
            return None
        try:
            dt = datetime.fromisoformat(ts_str)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except (ValueError, TypeError):
            return None

    # Build sorted iteration end-timestamps for bucketing metrics entries.
    iter_boundaries = []
    for it in non_baseline:
        end_ts = parse_ts(it.get("timestamp"))
        if end_ts is None:
            continue
        iter_boundaries.append({
            "iter_id": f"iter-{it['iteration']}",
            "end_ts": end_ts,
        })
    iter_boundaries.sort(key=lambda b: b["end_ts"])

    if not iter_boundaries:
        return {}

    # Assign each metrics entry to the first iteration whose end_ts >= entry_ts.
    iter_entries = {b["iter_id"]: [] for b in iter_boundaries}
    for entry in entries:
        entry_ts = parse_ts(entry.get("timestamp"))
        if entry_ts is None:
            continue
        assigned = None
        for b in iter_boundaries:
            if entry_ts <= b["end_ts"]:
                assigned = b["iter_id"]
                break
        if assigned is None:
            # Entry after last completed iteration (e.g., failed/in-progress subsequent iter)
            assigned = iter_boundaries[-1]["iter_id"]
        iter_entries[assigned].append(entry)

    # Aggregate per iteration: sum all design entries and all execute entries.
    for b in iter_boundaries:
        iter_id = b["iter_id"]
        entries_for_iter = iter_entries[iter_id]

        design_entries = [e for e in entries_for_iter if e.get("role") == "planner"]
        execute_entries = [e for e in entries_for_iter if e.get("role") == "executor"]

        iter_metrics = {"design": None, "execute": None, "total_cost": 0, "total_duration_ms": 0, "total_turns": 0}

        if design_entries:
            iter_metrics["design"] = {
                "model": design_entries[-1].get("model", "unknown"),
                "cost_usd": sum(e.get("cost_usd") or 0 for e in design_entries),
                "duration_ms": sum(e.get("duration_ms") or 0 for e in design_entries),
                "num_turns": sum(e.get("num_turns") or 0 for e in design_entries),
                "input_tokens": sum(e.get("input_tokens") or 0 for e in design_entries),
                "output_tokens": sum(e.get("output_tokens") or 0 for e in design_entries),
            }

        if execute_entries:
            iter_metrics["execute"] = {
                "model": execute_entries[-1].get("model", "unknown"),
                "cost_usd": sum(e.get("cost_usd") or 0 for e in execute_entries),
                "duration_ms": sum(e.get("duration_ms") or 0 for e in execute_entries),
                "num_turns": sum(e.get("num_turns") or 0 for e in execute_entries),
                "input_tokens": sum(e.get("input_tokens") or 0 for e in execute_entries),
                "output_tokens": sum(e.get("output_tokens") or 0 for e in execute_entries),
            }

        for phase in ["design", "execute"]:
            if iter_metrics[phase]:
                iter_metrics["total_cost"] += iter_metrics[phase]["cost_usd"]
                iter_metrics["total_duration_ms"] += iter_metrics[phase]["duration_ms"]
                iter_metrics["total_turns"] += iter_metrics[phase]["num_turns"]

        result[iter_id] = iter_metrics

    return result


def build_iterations_graph(ledger: dict, principles: dict) -> dict:
    """Build nodes and links for the iterations-centric D3 graph."""
    nodes = []
    links = []
    iterations = ledger.get("iterations", [])
    all_principles = {p["id"]: p for p in principles.get("principles", [])}

    # Build iteration nodes
    for it in iterations:
        iteration_id = f"iter-{it['iteration']}"
        outcome = it.get("h_main_result") or "BASELINE"
        accuracy = it.get("prediction_accuracy")
        acc_str = f"{accuracy['accuracy_pct']}% ({accuracy['arms_correct']}/{accuracy['arms_total']})" if accuracy else "N/A"

        tooltip = (
            f"<strong>{it.get('family', iteration_id)}</strong><br>"
            f"Iteration: {it['iteration']}<br>"
            f"Outcome: {outcome}<br>"
            f"Prediction accuracy: {acc_str}<br>"
            f"Principles extracted: {len(it.get('principles_extracted', []))}"
        )

        nodes.append({
            "id": iteration_id,
            "nodeType": "iteration",
            "label": f"iter-{it['iteration']}",
            "family": it.get("family", ""),
            "outcome": outcome,
            "tooltip": tooltip,
            "principles": [pe["id"] for pe in it.get("principles_extracted", [])],
        })

    # Sequential "led-to" edges
    for i in range(len(iterations) - 1):
        links.append({
            "source": f"iter-{iterations[i]['iteration']}",
            "target": f"iter-{iterations[i+1]['iteration']}",
            "type": "led-to",
        })

    # Build principle sub-nodes and link to parent iteration
    for it in iterations:
        iteration_id = f"iter-{it['iteration']}"
        for pe in it.get("principles_extracted", []):
            pid = pe["id"]
            principle = all_principles.get(pid)
            if not principle:
                continue

            principle_node_id = f"{iteration_id}-{pid}"
            tooltip = (
                f"<strong>{pid}</strong><br>"
                f"{principle['statement'][:150]}...<br>"
                f"Confidence: {principle.get('confidence', 'unknown')}<br>"
                f"Regime: {principle.get('regime', 'N/A')[:80]}"
            )

            nodes.append({
                "id": principle_node_id,
                "nodeType": "principle",
                "label": pid,
                "tooltip": tooltip,
            })

            links.append({
                "source": iteration_id,
                "target": principle_node_id,
                "type": "principle-of",
            })

    return {"nodes": nodes, "links": links}


def build_principles_graph(ledger: dict, principles: dict) -> dict:
    """Build principle node data for panel lookups (statement, confidence, regime, mechanism).

    The Knowledge tab uses concept/parameter/entity nodes instead of principle nodes,
    but panels still need to look up principle details by ID.
    """
    nodes = []
    links = []
    iterations = ledger.get("iterations", [])
    all_principles = {p["id"]: p for p in principles.get("principles", [])}

    # Track which iterations extracted each principle
    principle_iterations = {}  # pid -> list of iteration numbers
    for it in iterations:
        for pe in it.get("principles_extracted", []):
            pid = pe["id"]
            if pid not in principle_iterations:
                principle_iterations[pid] = []
            if it["iteration"] not in principle_iterations[pid]:
                principle_iterations[pid].append(it["iteration"])

    # Build principle nodes
    for pid, principle in all_principles.items():
        iters = principle_iterations.get(pid, [])

        nodes.append({
            "id": pid,
            "nodeType": "principle",
            "label": pid,
            "statement": principle["statement"][:200],
            "confidence": principle.get("confidence", "unknown"),
            "regime": principle.get("regime", ""),
            "mechanism": principle.get("mechanism", ""),
        })

    # Build principle-to-principle edges from contradicts/superseded_by
    for pid, principle in all_principles.items():
        for contra_id in principle.get("contradicts", []):
            if contra_id in all_principles:
                edge = {"source": pid, "target": contra_id, "type": "contradicts"}
                reverse = {"source": contra_id, "target": pid, "type": "contradicts"}
                if edge not in links and reverse not in links:
                    links.append(edge)

        superseded_by = principle.get("superseded_by")
        if superseded_by and superseded_by in all_principles:
            links.append({
                "source": pid,
                "target": superseded_by,
                "type": "supersedes",
            })

    return {"nodes": nodes, "links": links}


def load_findings(campaign_path: Path, ledger: dict) -> dict:
    """Load findings.json from each iteration's run directory.

    Returns a dict keyed by iter-N with the arms array from findings.json.
    """
    findings = {}
    for it in ledger.get("iterations", []):
        iter_num = it["iteration"]
        iter_id = f"iter-{iter_num}"
        findings_path = campaign_path / "runs" / iter_id / "findings.json"
        if findings_path.exists():
            try:
                data = json.loads(findings_path.read_text())
                findings[iter_id] = data.get("arms", [])
            except (json.JSONDecodeError, KeyError):
                pass
    return findings


def load_iter_narratives(campaign_path: Path, ledger: dict) -> dict:
    """Load iteration narrative data: problem.md title and family transitions.

    Returns a dict keyed by iter-N with:
      - title: first heading from problem.md (stripped of "# Problem Framing — " prefix)
      - family: the experiment family name
    """
    narratives = {}
    iterations = ledger.get("iterations", [])
    for i, it in enumerate(iterations):
        iter_num = it["iteration"]
        iter_id = f"iter-{iter_num}"
        family = it.get("family", "")

        # Extract title from problem.md
        title = ""
        problem_path = campaign_path / "runs" / iter_id / "problem.md"
        if problem_path.exists():
            first_line = problem_path.read_text().split("\n", 1)[0]
            # Strip markdown heading and common prefixes
            title = re.sub(r"^#\s*", "", first_line)
            title = re.sub(r"^Problem Framing\s*[—–-]\s*", "", title, flags=re.IGNORECASE)
            title = re.sub(r"^Iter(ation)?\s*-?\d+:?\s*", "", title, flags=re.IGNORECASE)
            title = title.strip()

        narratives[iter_id] = {
            "title": title,
            "family": family,
        }
    return narratives


def build_insights_data(wiki_dir: Path, campaign_name: str) -> dict:
    """Build insights data from per-campaign JSON files."""
    campaign_dir = wiki_dir / "campaigns" / campaign_name
    result = {}

    # Read dead-ends.json
    dead_ends_path = campaign_dir / "dead-ends.json"
    if dead_ends_path.exists():
        with open(dead_ends_path) as f:
            result["dead_ends"] = json.load(f)

    # Read frontiers.json
    frontiers_path = campaign_dir / "frontiers.json"
    if frontiers_path.exists():
        with open(frontiers_path) as f:
            result["frontiers"] = json.load(f)

    # Read interactions.json
    interactions_path = campaign_dir / "interactions.json"
    if interactions_path.exists():
        with open(interactions_path) as f:
            result["interactions"] = json.load(f)

    return result


def _make_kg_id(node_type: str, name: str) -> str:
    """Generate a stable node ID from type and name.

    Must match the JS slug algorithm: replace all non-[a-z0-9] with dashes.
    """
    import re
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return f"{node_type}-{slug}"


def _build_knowledge_graph(concepts_data: dict) -> dict:
    """Build nodes+edges for the Knowledge tab from explicit relationship fields."""
    if not concepts_data:
        return {"nodes": [], "edges": []}

    nodes = []
    for concept in concepts_data.get("concepts", []):
        nodes.append({
            "id": _make_kg_id("concept", concept["name"]),
            "name": concept["name"],
            "type": "concept",
            "definition": concept.get("definition", ""),
            "principles": concept.get("principles", []),
        })
    for param in concepts_data.get("parameters", []):
        nodes.append({
            "id": _make_kg_id("param", param["name"]),
            "name": param["name"],
            "type": "parameter",
            "definition": param.get("definition", ""),
            "principles": param.get("principles", []),
            "evolution": param.get("evolution", []),
        })
    for entity in concepts_data.get("entities", []):
        nodes.append({
            "id": _make_kg_id("entity", entity["name"]),
            "name": entity["name"],
            "type": "entity",
            "definition": entity.get("definition", ""),
            "principles": entity.get("principles", []),
        })

    node_index = {n["id"]: n for n in nodes}
    edges = []

    for concept in concepts_data.get("concepts", []):
        concept_id = _make_kg_id("concept", concept["name"])
        for entity_name in concept.get("operates_on", []):
            entity_id = _make_kg_id("entity", entity_name)
            if entity_id in node_index:
                shared = set(concept.get("principles", [])) & set(node_index[entity_id].get("principles", []))
                edges.append({"source": concept_id, "target": entity_id, "shared_principles": sorted(shared), "edge_type": "operates_on"})

    # Derive has_param edges from parameter-side parent_concept (guarantees single owner)
    for param in concepts_data.get("parameters", []):
        parent_name = param.get("parent_concept")
        if not parent_name:
            continue
        concept_id = _make_kg_id("concept", parent_name)
        param_id = _make_kg_id("param", param["name"])
        if concept_id in node_index and param_id in node_index:
            shared = set(node_index[concept_id].get("principles", [])) & set(param.get("principles", []))
            edges.append({"source": concept_id, "target": param_id, "shared_principles": sorted(shared), "edge_type": "has_param"})

    # Entity↔Entity edges from principle overlap (≥2 shared)
    entity_nodes = [n for n in nodes if n["type"] == "entity"]
    for i in range(len(entity_nodes)):
        for j in range(i + 1, len(entity_nodes)):
            shared = set(entity_nodes[i]["principles"]) & set(entity_nodes[j]["principles"])
            if len(shared) >= 2:
                edges.append({"source": entity_nodes[i]["id"], "target": entity_nodes[j]["id"], "shared_principles": sorted(shared), "edge_type": "interacts"})

    return {"nodes": nodes, "edges": edges}


def main():
    parser = argparse.ArgumentParser(description="Visualize a Nous campaign as a knowledge graph")
    parser.add_argument("campaign_path", help="Path to .nous/<campaign-name>/ directory")
    parser.add_argument("--output", "-o", help="Output HTML file path")
    parser.add_argument("--wiki", "-w", default=str(Path.home() / ".nous" / "wiki"),
                        help="Path to wiki directory (default: ~/.nous/wiki/)")
    parser.add_argument("--insights", help="JSON file with pre-summarized insights (overrides wiki extraction)")
    parser.add_argument("--summaries", "-s", help="JSON file with iteration summaries (keyed by iter-N)")
    parser.add_argument("--concepts", help="JSON file with concepts and entities for the Knowledge tab")
    parser.add_argument("--no-open", action="store_true", help="Don't open browser")
    parser.add_argument("--summary-md", help="Markdown file for the Summary tab (overrides wiki lookup)")
    args = parser.parse_args()

    campaign_path = Path(args.campaign_path).resolve()
    campaign_name = campaign_path.name

    # Default output location
    if args.output:
        output_path = Path(args.output)
    else:
        viz_dir = Path.home() / ".nous" / "wiki" / "viz"
        viz_dir.mkdir(parents=True, exist_ok=True)
        output_path = viz_dir / f"{campaign_name}.html"

    ledger, principles = load_campaign(campaign_path)
    iter_graph = build_iterations_graph(ledger, principles)
    princ_graph = build_principles_graph(ledger, principles)

    # Build insights: use pre-summarized file if provided, else extract raw from wiki
    if args.insights:
        with open(args.insights) as f:
            insights = json.load(f)
    else:
        wiki_dir = Path(args.wiki)
        insights = build_insights_data(wiki_dir, campaign_name)

    # Load iteration summaries
    if args.summaries:
        with open(args.summaries) as f:
            iter_summaries = json.load(f)
    else:
        iter_summaries = {}

    # Load concepts/entities and pre-compute knowledge graph
    if args.concepts:
        with open(args.concepts) as f:
            concepts_data = json.load(f)
    else:
        concepts_data = None

    knowledge_graph_data = _build_knowledge_graph(concepts_data) if concepts_data else {"nodes": [], "edges": []}

    # Load findings, narratives, and LLM cost metrics from run directories
    findings_data = load_findings(campaign_path, ledger)
    narratives_data = load_iter_narratives(campaign_path, ledger)
    llm_metrics = load_llm_metrics(campaign_path, ledger)

    # Load campaign context from campaign.yaml
    campaign_context = {}
    campaign_yaml_path = campaign_path / "campaign.yaml"
    if campaign_yaml_path.exists():
        import yaml
        campaign_config = yaml.safe_load(campaign_yaml_path.read_text()) or {}
        campaign_context["research_question"] = campaign_config.get("research_question", "").strip()
        # Extract runtime metadata (target_commit, target_repo, nous_version, started_at)
        runtime = campaign_config.get("runtime") or {}
        if runtime.get("target_commit"):
            campaign_context["target_commit"] = runtime["target_commit"]
        if runtime.get("target_repo"):
            campaign_context["target_repo"] = runtime["target_repo"]
        if runtime.get("nous_version"):
            campaign_context["nous_version"] = runtime["nous_version"]
        if runtime.get("started_at"):
            campaign_context["started_at"] = runtime["started_at"]

    # Load summary.md for the Summary tab
    if args.summary_md:
        summary_md_path = Path(args.summary_md)
        if not summary_md_path.exists():
            print(f"Error: --summary-md file not found: {args.summary_md}", file=sys.stderr)
            sys.exit(1)
        summary_md = summary_md_path.read_text()
    else:
        summary_md = ""
        wiki_campaigns_dir = Path.home() / ".nous" / "wiki" / "campaigns" / campaign_name
        summary_md_path = wiki_campaigns_dir / "summary.md"
        if summary_md_path.exists():
            summary_md = summary_md_path.read_text()

    html = HTML_TEMPLATE.format(
        title=campaign_name,
        iter_data_json=json.dumps(iter_graph, indent=2),
        princ_data_json=json.dumps(princ_graph, indent=2),
        insights_data_json=json.dumps(insights),
        iter_summaries_json=json.dumps(iter_summaries),
        campaign_context_json=json.dumps(campaign_context),
        concepts_data_json=json.dumps(concepts_data),
        findings_data_json=json.dumps(findings_data),
        narratives_data_json=json.dumps(narratives_data),
        summary_md_json=json.dumps(summary_md),
        knowledge_graph_json=json.dumps(knowledge_graph_data),
        llm_metrics_json=json.dumps(llm_metrics),
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html)
    print(f"Generated: {output_path}")

    if not args.no_open:
        webbrowser.open(f"file://{output_path}")


if __name__ == "__main__":
    main()
