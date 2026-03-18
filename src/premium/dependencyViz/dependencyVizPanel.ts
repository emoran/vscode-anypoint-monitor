import * as vscode from 'vscode';
import { TracerGraphData } from './graphLayout';

export function showConnectionTracerPanel(
    context: vscode.ExtensionContext,
    graphData: TracerGraphData
): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
        'liveConnectionTracer',
        `Connection Tracer - ${graphData.seedApp}`,
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = getTracerHtml(graphData);
    return panel;
}

function getTracerHtml(graphData: TracerGraphData): string {
    const dataJson = JSON.stringify(graphData);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Live Connection Tracer</title>
<style>
:root {
    --bg: #1e1e1e; --surface: #252526; --surface2: #2d2d30;
    --border: #3e3e42; --text: #cccccc; --text-muted: #888;
    --red: #f44747; --yellow: #cca700; --green: #4ec9b0;
    --blue: #569cd6; --purple: #c586c0; --orange: #ce9178;
    --radius: 6px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); overflow: hidden; }

.page { display: flex; flex-direction: column; height: 100vh; width: 100vw; }

.header-bar {
    flex-shrink: 0; height: 46px;
    background: var(--surface); border-bottom: 1px solid var(--border);
    display: flex; align-items: center; padding: 8px 16px; gap: 12px;
}
.header-bar h2 { font-size: 14px; font-weight: 600; white-space: nowrap; }
.seed-badge {
    background: var(--blue); color: #fff; padding: 2px 10px; border-radius: 12px;
    font-size: 12px; font-weight: 500; white-space: nowrap; max-width: 280px;
    overflow: hidden; text-overflow: ellipsis;
}
.env-badge { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.header-spacer { flex: 1; }
.refresh-info { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.refresh-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--green); margin-right: 4px; animation: pulse 2s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.btn { padding: 4px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface2); color: var(--text); cursor: pointer; font-size: 11px; white-space: nowrap; }
.btn:hover { background: var(--border); }
.btn-primary { background: var(--blue); border-color: var(--blue); color: #fff; }

.main-row { display: flex; flex: 1; min-height: 0; }

.graph-col { flex: 1; display: flex; flex-direction: column; position: relative; min-width: 0; }
.canvas-wrap { flex: 1; position: relative; overflow: hidden; }
canvas { display: block; width: 100%; height: 100%; }

.summary-bar {
    flex-shrink: 0; height: 38px;
    background: var(--surface); border-top: 1px solid var(--border);
    display: flex; align-items: center; padding: 6px 16px; gap: 16px;
    font-size: 12px;
}
.summary-bar .stat { display: flex; align-items: center; gap: 4px; }
.stat-dot { width: 8px; height: 8px; border-radius: 50%; }

.legend {
    position: absolute; bottom: 12px; left: 16px; z-index: 10;
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 10px 12px; font-size: 11px;
}
.legend-title { font-weight: 600; margin-bottom: 6px; }
.legend-item { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.legend-color { width: 12px; height: 3px; border-radius: 1px; }

.detail-sidebar {
    width: 320px; flex-shrink: 0;
    background: var(--surface); border-left: 1px solid var(--border);
    display: flex; flex-direction: column; overflow: hidden;
}
.detail-header { padding: 12px 16px; border-bottom: 1px solid var(--border); }
.detail-header h3 { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
.detail-header .detail-subtitle { font-size: 11px; color: var(--text-muted); }
.detail-content { flex: 1; overflow-y: auto; padding: 0; }

.detail-section { padding: 12px 16px; border-bottom: 1px solid var(--border); }
.detail-section-title { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; font-weight: 600; }
.metric-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px; }
.metric-label { color: var(--text-muted); }
.metric-value { font-weight: 500; }
.metric-value.healthy { color: var(--green); }
.metric-value.degraded { color: var(--yellow); }
.metric-value.failing { color: var(--red); }
.metric-value.nodata { color: var(--text-muted); }

.conn-item { padding: 8px 12px; border-radius: var(--radius); margin-bottom: 4px; cursor: pointer; background: var(--surface2); display: flex; align-items: center; gap: 8px; font-size: 12px; }
.conn-item:hover { background: var(--border); }
.conn-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.conn-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conn-method { font-size: 10px; color: var(--text-muted); flex-shrink: 0; }

.detail-actions { padding: 12px 16px; border-top: 1px solid var(--border); display: flex; gap: 6px; flex-wrap: wrap; }

.tooltip {
    position: absolute; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 10px 12px; font-size: 12px;
    pointer-events: none; display: none; z-index: 30; max-width: 280px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
}
.tt-name { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
.tt-row { display: flex; justify-content: space-between; gap: 12px; margin-top: 2px; }
.tt-label { color: var(--text-muted); }
.tt-hint { margin-top: 6px; font-size: 10px; color: var(--text-muted); font-style: italic; border-top: 1px solid var(--border); padding-top: 4px; }

.empty-state {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    text-align: center; z-index: 5; max-width: 380px;
}
.empty-state h3 { font-size: 16px; margin-bottom: 8px; }
.empty-state p { font-size: 13px; color: var(--text-muted); line-height: 1.5; margin-bottom: 12px; }
</style>
</head>
<body>

<div class="page">
    <div class="header-bar">
        <h2>Live Connection Tracer</h2>
        <div class="seed-badge" id="seedBadge"></div>
        <div class="env-badge" id="envBadge"></div>
        <div class="header-spacer"></div>
        <div class="refresh-info"><span class="refresh-dot"></span><span id="refreshTime">Just now</span></div>
        <button class="btn" onclick="pickDifferentApp()">Change App</button>
    </div>

    <div class="main-row">
        <div class="graph-col">
            <div class="canvas-wrap">
                <canvas id="graphCanvas"></canvas>
                <div class="tooltip" id="tooltip"></div>
                <div class="legend" id="legend">
                    <div class="legend-title">Connection Health</div>
                    <div class="legend-item"><div class="legend-color" style="background:var(--green)"></div> Healthy (&lt;5% errors, &lt;2s)</div>
                    <div class="legend-item"><div class="legend-color" style="background:var(--yellow)"></div> Degraded (5-15% err or 2-5s)</div>
                    <div class="legend-item"><div class="legend-color" style="background:var(--red)"></div> Failing (&gt;15% err or &gt;5s)</div>
                    <div class="legend-item"><div class="legend-color" style="background:var(--text-muted)"></div> No data</div>
                    <div style="margin-top:6px" class="legend-title">Edge Confidence</div>
                    <div class="legend-item"><svg width="30" height="6"><line x1="0" y1="3" x2="30" y2="3" stroke="var(--green)" stroke-width="2.5"/></svg> API Contract (high)</div>
                    <div class="legend-item"><svg width="30" height="6"><line x1="0" y1="3" x2="30" y2="3" stroke="var(--green)" stroke-width="1.5" stroke-dasharray="6,3"/></svg> Property / Autodiscovery</div>
                    <div class="legend-item"><svg width="30" height="6"><line x1="0" y1="3" x2="30" y2="3" stroke="var(--green)" stroke-width="1" stroke-dasharray="2,3"/></svg> Naming Convention</div>
                </div>
                <div class="empty-state" id="emptyState" style="display:none">
                    <h3>No connections discovered</h3>
                    <p>The tracer could not find any API contracts, runtime properties, or naming patterns connecting this application to others.</p>
                    <p>Try selecting an application that is registered in API Manager or has downstream URL properties configured.</p>
                    <button class="btn btn-primary" onclick="pickDifferentApp()">Pick a different app</button>
                </div>
            </div>
            <div class="summary-bar" id="summaryBar"></div>
        </div>

        <div class="detail-sidebar" id="detailSidebar">
            <div class="detail-header">
                <h3 id="detailTitle">Select a node</h3>
                <div class="detail-subtitle" id="detailSubtitle">Click any app in the graph</div>
            </div>
            <div class="detail-content" id="detailContent">
                <div class="detail-section" style="text-align:center;color:var(--text-muted);padding-top:40px">
                    Click any application node to see its connection details and live metrics.
                </div>
            </div>
            <div class="detail-actions" id="detailActions" style="display:none">
                <button class="btn btn-primary" id="traceBtn" onclick="traceSelected()">Trace from this app</button>
                <button class="btn" onclick="openCommandCenter()">Command Center</button>
                <button class="btn" onclick="openLogs()">Real-Time Logs</button>
            </div>
        </div>
    </div>
</div>

<script>
const vscode = acquireVsCodeApi();
let graphData = ${dataJson};
let nodes = graphData.nodes;
let edges = graphData.edges;

const HEALTH_COLORS = { healthy: '#4ec9b0', degraded: '#cca700', failing: '#f44747', nodata: '#888888' };
const canvas = document.getElementById('graphCanvas');
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip');

let width = 800, height = 600;
let transform = { x: 0, y: 0, k: 1 };
let dragging = null;
let panning = false;
let panStart = { x: 0, y: 0 };
let selectedNode = null;
let animOffset = 0;
let lastRefresh = Date.now();

function init() {
    document.getElementById('seedBadge').textContent = graphData.seedApp;
    document.getElementById('envBadge').textContent = graphData.environmentName;
    renderSummary();

    if (edges.length === 0 && nodes.length <= 1) {
        document.getElementById('emptyState').style.display = 'block';
        document.getElementById('legend').style.display = 'none';
    }

    resize();
    initPositions();
    simulate();
    centerGraph();
    requestAnimationFrame(draw);
}

window.addEventListener('message', e => {
    if (e.data.command === 'updateMetrics') {
        graphData = e.data.graphData;
        const oldPositions = {};
        nodes.forEach(n => { oldPositions[n.id] = { x: n.x, y: n.y }; });
        nodes = graphData.nodes;
        edges = graphData.edges;
        nodes.forEach(n => {
            if (oldPositions[n.id]) { n.x = oldPositions[n.id].x; n.y = oldPositions[n.id].y; }
        });
        lastRefresh = Date.now();
        document.getElementById('refreshTime').textContent = 'Just now';
        renderSummary();
        if (selectedNode) {
            const fresh = nodes.find(n => n.id === selectedNode.id);
            if (fresh) { selectedNode = fresh; renderDetail(fresh); }
        }
    }
});

setInterval(() => {
    const sec = Math.round((Date.now() - lastRefresh) / 1000);
    if (sec < 5) { document.getElementById('refreshTime').textContent = 'Just now'; }
    else if (sec < 60) { document.getElementById('refreshTime').textContent = sec + 's ago'; }
    else { document.getElementById('refreshTime').textContent = Math.round(sec / 60) + 'm ago'; }
}, 5000);

function renderSummary() {
    const s = graphData.summary;
    document.getElementById('summaryBar').innerHTML =
        '<div class="stat"><strong>' + s.totalConnections + '</strong>&nbsp;connections</div>' +
        '<div class="stat"><div class="stat-dot" style="background:var(--green)"></div>' + s.healthy + ' healthy</div>' +
        '<div class="stat"><div class="stat-dot" style="background:var(--yellow)"></div>' + s.degraded + ' degraded</div>' +
        '<div class="stat"><div class="stat-dot" style="background:var(--red)"></div>' + s.failing + ' failing</div>' +
        '<div class="stat"><div class="stat-dot" style="background:var(--text-muted)"></div>' + s.nodata + ' no data</div>' +
        '<div style="flex:1"></div>' +
        '<div class="stat"><strong>' + s.totalRequestsPerMin + '</strong>&nbsp;req/min total</div>';
}

function resize() {
    const wrap = document.querySelector('.canvas-wrap');
    if (!wrap) return;
    width = wrap.clientWidth;
    height = wrap.clientHeight;
    if (width < 100) width = 800;
    if (height < 100) height = 600;
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

const SIM_ITERATIONS = 300;
const REPULSION = 2500;
const ATTRACTION = 0.008;
const DAMPING = 0.9;
const LINK_DISTANCE = 180;

function initPositions() {
    const cx = width / 2 / (transform.k || 1);
    const cy = height / 2 / (transform.k || 1);
    const seed = nodes.find(n => n.isSeed);
    if (seed) { seed.x = cx; seed.y = cy; seed.vx = 0; seed.vy = 0; }
    const others = nodes.filter(n => !n.isSeed);
    others.forEach((n, i) => {
        const angle = (2 * Math.PI * i) / Math.max(others.length, 1);
        const r = 180 + Math.random() * 60;
        n.x = cx + r * Math.cos(angle);
        n.y = cy + r * Math.sin(angle);
        n.vx = 0; n.vy = 0;
    });
}

function simulate() {
    if (nodes.length <= 1) return;
    const nodeMap = {};
    nodes.forEach(n => nodeMap[n.id] = n);
    const cx = width / 2, cy = height / 2;

    for (let iter = 0; iter < SIM_ITERATIONS; iter++) {
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i], b = nodes[j];
                let dx = b.x - a.x, dy = b.y - a.y;
                let dist = Math.sqrt(dx * dx + dy * dy) || 1;
                let force = REPULSION / (dist * dist);
                let fx = (dx / dist) * force, fy = (dy / dist) * force;
                a.vx -= fx; a.vy -= fy;
                b.vx += fx; b.vy += fy;
            }
        }

        for (const edge of edges) {
            const a = nodeMap[edge.source], b = nodeMap[edge.target];
            if (!a || !b) continue;
            let dx = b.x - a.x, dy = b.y - a.y;
            let dist = Math.sqrt(dx * dx + dy * dy) || 1;
            let force = (dist - LINK_DISTANCE) * ATTRACTION;
            let fx = (dx / dist) * force, fy = (dy / dist) * force;
            a.vx += fx; a.vy += fy;
            b.vx -= fx; b.vy -= fy;
        }

        nodes.forEach(n => {
            n.vx += (cx - n.x) * 0.0005;
            n.vy += (cy - n.y) * 0.0005;
            n.vx *= DAMPING; n.vy *= DAMPING;
            n.x += n.vx; n.y += n.vy;
        });
    }
}

function centerGraph() {
    if (nodes.length === 0) return;
    const minX = Math.min(...nodes.map(n => n.x));
    const maxX = Math.max(...nodes.map(n => n.x));
    const minY = Math.min(...nodes.map(n => n.y));
    const maxY = Math.max(...nodes.map(n => n.y));
    const gw = (maxX - minX) + 200;
    const gh = (maxY - minY) + 200;
    const scale = Math.min(width / gw, height / gh, 1.5);
    transform.k = Math.max(scale, 0.3);
    transform.x = width / 2 - ((minX + maxX) / 2) * transform.k;
    transform.y = height / 2 - ((minY + maxY) / 2) * transform.k;
}

function getNodeRadius(node) {
    if (node.isSeed) return 24;
    if (node.type === 'EXTERNAL') return 10;
    return 16;
}

function getNodeColor(node) {
    if (node.type === 'EXTERNAL') return '#c586c0';
    return HEALTH_COLORS[node.health] || HEALTH_COLORS.nodata;
}

function getEdgeStyle(edge) {
    const color = HEALTH_COLORS[edge.health] || HEALTH_COLORS.nodata;
    switch (edge.confidence) {
        case 'high': return { dash: [], width: 2.5, color };
        case 'medium': return { dash: [8, 4], width: 1.8, color };
        case 'low': return { dash: [3, 4], width: 1.2, color };
        default: return { dash: [4, 4], width: 1, color };
    }
}

function draw() {
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    animOffset = (animOffset + 0.5) % 40;

    const nodeMap = {};
    nodes.forEach(n => nodeMap[n.id] = n);

    // Draw edges
    for (const edge of edges) {
        const a = nodeMap[edge.source], b = nodeMap[edge.target];
        if (!a || !b) continue;

        const style = getEdgeStyle(edge);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const rA = getNodeRadius(a) + 2;
        const rB = getNodeRadius(b) + 6;
        const x1 = a.x + Math.cos(angle) * rA;
        const y1 = a.y + Math.sin(angle) * rA;
        const x2 = b.x - Math.cos(angle) * rB;
        const y2 = b.y - Math.sin(angle) * rB;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.width;
        ctx.setLineDash(style.dash.length > 0 ? style.dash : [12, 6]);
        ctx.lineDashOffset = -animOffset;
        ctx.globalAlpha = 0.8;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        ctx.globalAlpha = 1;

        // Arrow head
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 10 * Math.cos(angle - 0.25), y2 - 10 * Math.sin(angle - 0.25));
        ctx.lineTo(x2 - 10 * Math.cos(angle + 0.25), y2 - 10 * Math.sin(angle + 0.25));
        ctx.closePath();
        ctx.fillStyle = style.color;
        ctx.globalAlpha = 0.8;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Edge label
        const sourceNode = nodeMap[edge.source];
        if (sourceNode && sourceNode.metrics && sourceNode.metrics.requestsPerMin > 0) {
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            ctx.font = '9px -apple-system, sans-serif';
            ctx.fillStyle = style.color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(sourceNode.metrics.requestsPerMin + ' req/m', mx, my - 4);
        }
    }

    // Draw nodes
    for (const node of nodes) {
        const r = getNodeRadius(node);
        const color = getNodeColor(node);
        const isSelected = selectedNode && selectedNode.id === node.id;

        // Seed glow
        if (node.isSeed) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 12, 0, Math.PI * 2);
            const grad = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, r + 12);
            grad.addColorStop(0, 'rgba(86,156,214,0.3)');
            grad.addColorStop(1, 'rgba(86,156,214,0)');
            ctx.fillStyle = grad;
            ctx.fill();
        }

        // Selection ring
        if (isSelected) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 5, 0, Math.PI * 2);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Node body
        ctx.beginPath();
        if (node.type === 'EXTERNAL') {
            const s = r * 1.4;
            ctx.rect(node.x - s / 2, node.y - s / 2, s, s);
        } else {
            ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        }
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = isSelected ? '#fff' : 'rgba(255,255,255,0.4)';
        ctx.lineWidth = isSelected ? 2.5 : 1;
        ctx.stroke();

        // Type badge inside node
        if (node.type !== 'EXTERNAL') {
            ctx.font = 'bold 8px -apple-system, sans-serif';
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(node.type, node.x, node.y);
        }

        // Name label below
        ctx.font = (node.isSeed ? 'bold ' : '') + '10px -apple-system, sans-serif';
        ctx.fillStyle = '#e0e0e0';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const label = node.name.length > 30 ? node.name.substring(0, 28) + '..' : node.name;
        ctx.fillText(label, node.x, node.y + r + 6);

        // Metrics badge
        if (node.metrics && node.metrics.requestsPerMin > 0) {
            ctx.font = '9px -apple-system, sans-serif';
            ctx.fillStyle = HEALTH_COLORS[node.health] || '#888';
            ctx.fillText(
                node.metrics.requestsPerMin + ' req/m | ' + node.metrics.errorRate.toFixed(1) + '% err',
                node.x, node.y + r + 18
            );
        }
    }

    ctx.restore();
    requestAnimationFrame(draw);
}

function screenToWorld(sx, sy) {
    return { x: (sx - transform.x) / transform.k, y: (sy - transform.y) / transform.k };
}

function findNodeAt(wx, wy) {
    for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const r = getNodeRadius(n) + 4;
        const dx = n.x - wx, dy = n.y - wy;
        if (dx * dx + dy * dy < r * r) return n;
    }
    return null;
}

canvas.addEventListener('mousedown', e => {
    const rect = canvas.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    const w = screenToWorld(ox, oy);
    const node = findNodeAt(w.x, w.y);
    if (node) {
        dragging = node;
        selectedNode = node;
        renderDetail(node);
    } else {
        panning = true;
        panStart = { x: ox - transform.x, y: oy - transform.y };
    }
});

canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    if (dragging) {
        const w = screenToWorld(ox, oy);
        dragging.x = w.x; dragging.y = w.y;
    } else if (panning) {
        transform.x = ox - panStart.x;
        transform.y = oy - panStart.y;
    } else {
        const w = screenToWorld(ox, oy);
        const node = findNodeAt(w.x, w.y);
        canvas.style.cursor = node ? 'pointer' : 'default';
        if (node) { showTooltip(ox, oy, node); }
        else { tooltip.style.display = 'none'; }
    }
});

canvas.addEventListener('mouseup', () => { dragging = null; panning = false; });
canvas.addEventListener('mouseleave', () => { dragging = null; panning = false; tooltip.style.display = 'none'; });

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    const scale = e.deltaY < 0 ? 1.1 : 0.9;
    const newK = Math.max(0.2, Math.min(4, transform.k * scale));
    transform.x = ox - (ox - transform.x) * (newK / transform.k);
    transform.y = oy - (oy - transform.y) * (newK / transform.k);
    transform.k = newK;
}, { passive: false });

canvas.addEventListener('dblclick', e => {
    const rect = canvas.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    const w = screenToWorld(ox, oy);
    const node = findNodeAt(w.x, w.y);
    if (node && node.type !== 'EXTERNAL') {
        vscode.postMessage({ command: 'retrace', appName: node.name });
    }
});

function showTooltip(x, y, node) {
    let html = '<div class="tt-name">' + escHtml(node.name) + '</div>';
    html += '<div class="tt-row"><span class="tt-label">Type</span><span>' + node.type + '</span></div>';
    html += '<div class="tt-row"><span class="tt-label">Status</span><span>' + node.status + '</span></div>';
    html += '<div class="tt-row"><span class="tt-label">Health</span><span style="color:' + (HEALTH_COLORS[node.health] || '#888') + '">' + node.health + '</span></div>';
    if (node.metrics) {
        const m = node.metrics;
        html += '<div class="tt-row"><span class="tt-label">Requests</span><span>' + m.requestsPerMin + ' req/min</span></div>';
        html += '<div class="tt-row"><span class="tt-label">Error rate</span><span style="color:' + (m.errorRate > 15 ? 'var(--red)' : m.errorRate > 5 ? 'var(--yellow)' : 'var(--green)') + '">' + m.errorRate.toFixed(1) + '%</span></div>';
        html += '<div class="tt-row"><span class="tt-label">Avg response</span><span>' + m.avgResponseTimeMs + ' ms</span></div>';
    }
    if (node.type !== 'EXTERNAL') {
        html += '<div class="tt-hint">Double-click to trace from this app</div>';
    }
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    tooltip.style.left = Math.min(x + 16, width - 290) + 'px';
    tooltip.style.top = (y + 16) + 'px';
}

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderDetail(node) {
    document.getElementById('detailTitle').textContent = node.name;
    document.getElementById('detailSubtitle').textContent =
        node.type + ' \\u00b7 ' + node.status + (node.isSeed ? ' \\u00b7 Seed' : '');

    const content = document.getElementById('detailContent');
    let html = '';

    html += '<div class="detail-section"><div class="detail-section-title">Live Metrics (15 min)</div>';
    if (node.metrics && node.metrics.totalRequests > 0) {
        const m = node.metrics;
        const errClass = m.errorRate > 15 ? 'failing' : m.errorRate > 5 ? 'degraded' : 'healthy';
        const rtClass = m.avgResponseTimeMs > 5000 ? 'failing' : m.avgResponseTimeMs > 2000 ? 'degraded' : 'healthy';
        html += '<div class="metric-row"><span class="metric-label">Requests/min</span><span class="metric-value">' + m.requestsPerMin + '</span></div>';
        html += '<div class="metric-row"><span class="metric-label">Total requests</span><span class="metric-value">' + m.totalRequests + '</span></div>';
        html += '<div class="metric-row"><span class="metric-label">Failed</span><span class="metric-value ' + errClass + '">' + m.failedRequests + '</span></div>';
        html += '<div class="metric-row"><span class="metric-label">Error rate</span><span class="metric-value ' + errClass + '">' + m.errorRate.toFixed(1) + '%</span></div>';
        html += '<div class="metric-row"><span class="metric-label">Avg response (p75)</span><span class="metric-value ' + rtClass + '">' + m.avgResponseTimeMs + ' ms</span></div>';
    } else {
        html += '<div style="color:var(--text-muted);font-size:12px">No metrics available</div>';
    }
    html += '</div>';

    const outgoing = edges.filter(e => e.source === node.id);
    if (outgoing.length > 0) {
        html += '<div class="detail-section"><div class="detail-section-title">Calls (' + outgoing.length + ')</div>';
        for (const edge of outgoing) {
            const target = nodes.find(n => n.id === edge.target);
            html += '<div class="conn-item" onclick="selectNodeById(\\'' + escAttr(edge.target) + '\\')">';
            html += '<div class="conn-dot" style="background:' + (HEALTH_COLORS[target ? target.health : 'nodata'] || '#888') + '"></div>';
            html += '<div class="conn-name">' + escHtml(edge.target) + '</div>';
            html += '<div class="conn-method">' + escHtml(edge.discoveryLabel) + '</div>';
            html += '</div>';
        }
        html += '</div>';
    }

    const incoming = edges.filter(e => e.target === node.id);
    if (incoming.length > 0) {
        html += '<div class="detail-section"><div class="detail-section-title">Called by (' + incoming.length + ')</div>';
        for (const edge of incoming) {
            const source = nodes.find(n => n.id === edge.source);
            html += '<div class="conn-item" onclick="selectNodeById(\\'' + escAttr(edge.source) + '\\')">';
            html += '<div class="conn-dot" style="background:' + (HEALTH_COLORS[source ? source.health : 'nodata'] || '#888') + '"></div>';
            html += '<div class="conn-name">' + escHtml(edge.source) + '</div>';
            html += '<div class="conn-method">' + escHtml(edge.discoveryLabel) + '</div>';
            html += '</div>';
        }
        html += '</div>';
    }

    if (outgoing.length === 0 && incoming.length === 0) {
        html += '<div class="detail-section" style="color:var(--text-muted);font-size:12px;text-align:center">No direct connections found</div>';
    }

    content.innerHTML = html;

    const actions = document.getElementById('detailActions');
    if (node.type !== 'EXTERNAL') {
        actions.style.display = 'flex';
        document.getElementById('traceBtn').style.display = node.isSeed ? 'none' : '';
    } else {
        actions.style.display = 'none';
    }
}

function escAttr(s) { return s.replace(/'/g, "\\\\'").replace(/"/g, '&quot;'); }

function selectNodeById(id) {
    const node = nodes.find(n => n.id === id);
    if (node) {
        selectedNode = node;
        renderDetail(node);
        transform.x = width / 2 - node.x * transform.k;
        transform.y = height / 2 - node.y * transform.k;
    }
}

function traceSelected() {
    if (selectedNode && selectedNode.type !== 'EXTERNAL') {
        vscode.postMessage({ command: 'retrace', appName: selectedNode.name });
    }
}

function openCommandCenter() {
    if (selectedNode) { vscode.postMessage({ command: 'openCommandCenter', appName: selectedNode.name }); }
}

function openLogs() {
    if (selectedNode) { vscode.postMessage({ command: 'openLogs', appName: selectedNode.name }); }
}

function pickDifferentApp() {
    vscode.postMessage({ command: 'pickApp' });
}

resize();
window.addEventListener('resize', () => { resize(); centerGraph(); });
init();
</script>
</body>
</html>`;
}
