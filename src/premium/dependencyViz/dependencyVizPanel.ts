import * as vscode from 'vscode';
import { TracerGraphData } from './graphLayout';
import {
    wrapWebviewHtml,
    badge,
    button,
    escapeHtml as uiEscapeHtml,
    escapeAttr
} from '../../webview/ui-kit';

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

    const body = `
    <div class="ct-page">
        <div class="ct-header-bar">
            <h2>Live Connection Tracer</h2>
            ${badge(uiEscapeHtml(graphData.seedApp), 'info', true)}
            <span class="ct-env-badge" id="envBadge">${uiEscapeHtml(graphData.environmentName)}</span>
            <div class="ct-spacer"></div>
            <div class="ct-refresh-info"><span class="ct-refresh-dot"></span><span id="refreshTime">Just now</span></div>
            ${button('Change App', { variant: 'ghost', onclick: 'pickDifferentApp()' })}
        </div>

        <div class="ct-main-row">
            <div class="ct-graph-col">
                <div class="ct-canvas-wrap">
                    <canvas id="graphCanvas"></canvas>
                    <div class="ct-tooltip" id="tooltip"></div>
                    <div class="ct-legend" id="legend">
                        <div class="ct-legend-title">Connection Health</div>
                        <div class="ct-legend-item"><div class="ct-legend-color" style="background:var(--am-success)"></div> Healthy (&lt;5% errors, &lt;2s)</div>
                        <div class="ct-legend-item"><div class="ct-legend-color" style="background:var(--am-warning)"></div> Degraded (5-15% err or 2-5s)</div>
                        <div class="ct-legend-item"><div class="ct-legend-color" style="background:var(--am-error)"></div> Failing (&gt;15% err or &gt;5s)</div>
                        <div class="ct-legend-item"><div class="ct-legend-color" style="background:var(--am-text-muted)"></div> No data</div>
                        <div style="margin-top:6px" class="ct-legend-title">Edge Confidence</div>
                        <div class="ct-legend-item"><svg width="30" height="6"><line x1="0" y1="3" x2="30" y2="3" stroke="var(--am-success)" stroke-width="2.5"/></svg> API Contract (high)</div>
                        <div class="ct-legend-item"><svg width="30" height="6"><line x1="0" y1="3" x2="30" y2="3" stroke="var(--am-success)" stroke-width="1.5" stroke-dasharray="6,3"/></svg> Property / Autodiscovery</div>
                        <div class="ct-legend-item"><svg width="30" height="6"><line x1="0" y1="3" x2="30" y2="3" stroke="var(--am-success)" stroke-width="1" stroke-dasharray="2,3"/></svg> Naming Convention</div>
                    </div>
                    <div class="ct-empty-state" id="emptyState" style="display:none">
                        <h3>No connections discovered</h3>
                        <p>The tracer could not find any API contracts, runtime properties, or naming patterns connecting this application to others.</p>
                        <p>Try selecting an application that is registered in API Manager or has downstream URL properties configured.</p>
                        ${button('Pick a different app', { variant: 'primary', onclick: 'pickDifferentApp()' })}
                    </div>
                </div>
                <div class="ct-summary-bar" id="summaryBar"></div>
            </div>

            <div class="ct-detail-sidebar" id="detailSidebar">
                <div class="ct-detail-header">
                    <h3 id="detailTitle">Select a node</h3>
                    <div class="ct-detail-subtitle" id="detailSubtitle">Click any app in the graph</div>
                </div>
                <div class="ct-detail-content" id="detailContent">
                    <div class="ct-detail-section" style="text-align:center;color:var(--am-text-muted);padding-top:40px">
                        Click any application node to see its connection details and live metrics.
                    </div>
                </div>
                <div class="ct-detail-actions" id="detailActions" style="display:none">
                    ${button('Trace from this app', { variant: 'primary', onclick: 'traceSelected()' })}
                    ${button('Command Center', { variant: 'ghost', onclick: 'openCommandCenter()' })}
                    ${button('Real-Time Logs', { variant: 'ghost', onclick: 'openLogs()' })}
                </div>
            </div>
        </div>
    </div>`;

    const scripts = getTracerScripts(dataJson);

    return wrapWebviewHtml({
        title: `Live Connection Tracer - ${uiEscapeHtml(graphData.seedApp)}`,
        body,
        scripts,
        extraStyles: getTracerStyles()
    });
}

function getTracerScripts(dataJson: string): string {
    return `
const vscode = acquireVsCodeApi();
let graphData = ${dataJson};
let nodes = graphData.nodes;
let edges = graphData.edges;

const HEALTH_COLORS = { healthy: getComputedStyle(document.documentElement).getPropertyValue('--am-success').trim() || '#4ec9b0', degraded: getComputedStyle(document.documentElement).getPropertyValue('--am-warning').trim() || '#cca700', failing: getComputedStyle(document.documentElement).getPropertyValue('--am-error').trim() || '#f44747', nodata: '#888888' };
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
    if (sec < 5) document.getElementById('refreshTime').textContent = 'Just now';
    else if (sec < 60) document.getElementById('refreshTime').textContent = sec + 's ago';
    else document.getElementById('refreshTime').textContent = Math.round(sec / 60) + 'm ago';
}, 5000);

function renderSummary() {
    const s = graphData.summary;
    document.getElementById('summaryBar').innerHTML =
        '<div class="ct-stat"><strong>' + s.totalConnections + '</strong>&nbsp;connections</div>' +
        '<div class="ct-stat"><div class="ct-stat-dot" style="background:var(--am-success)"></div>' + s.healthy + ' healthy</div>' +
        '<div class="ct-stat"><div class="ct-stat-dot" style="background:var(--am-warning)"></div>' + s.degraded + ' degraded</div>' +
        '<div class="ct-stat"><div class="ct-stat-dot" style="background:var(--am-error)"></div>' + s.failing + ' failing</div>' +
        '<div class="ct-stat"><div class="ct-stat-dot" style="background:var(--am-text-muted)"></div>' + s.nodata + ' no data</div>' +
        '<div style="flex:1"></div>' +
        '<div class="ct-stat"><strong>' + s.totalRequestsPerMin + '</strong>&nbsp;req/min total</div>';
}

function resize() {
    const wrap = document.querySelector('.ct-canvas-wrap');
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

function getNodeRadius(node) { return node.isSeed ? 24 : node.type === 'EXTERNAL' ? 10 : 16; }
function getNodeColor(node) { return node.type === 'EXTERNAL' ? '#c586c0' : (HEALTH_COLORS[node.health] || HEALTH_COLORS.nodata); }
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

    for (const edge of edges) {
        const a = nodeMap[edge.source], b = nodeMap[edge.target];
        if (!a || !b) continue;
        const style = getEdgeStyle(edge);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const rA = getNodeRadius(a) + 2;
        const rB = getNodeRadius(b) + 6;
        const x1 = a.x + Math.cos(angle) * rA, y1 = a.y + Math.sin(angle) * rA;
        const x2 = b.x - Math.cos(angle) * rB, y2 = b.y - Math.sin(angle) * rB;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.strokeStyle = style.color; ctx.lineWidth = style.width;
        ctx.setLineDash(style.dash.length > 0 ? style.dash : [12, 6]);
        ctx.lineDashOffset = -animOffset; ctx.globalAlpha = 0.8; ctx.stroke();
        ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 10 * Math.cos(angle - 0.25), y2 - 10 * Math.sin(angle - 0.25));
        ctx.lineTo(x2 - 10 * Math.cos(angle + 0.25), y2 - 10 * Math.sin(angle + 0.25));
        ctx.closePath(); ctx.fillStyle = style.color; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
        const sourceNode = nodeMap[edge.source];
        if (sourceNode && sourceNode.metrics && sourceNode.metrics.requestsPerMin > 0) {
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            ctx.font = '9px -apple-system, sans-serif'; ctx.fillStyle = style.color;
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
            ctx.fillText(sourceNode.metrics.requestsPerMin + ' req/m', mx, my - 4);
        }
    }

    for (const node of nodes) {
        const r = getNodeRadius(node);
        const color = getNodeColor(node);
        const isSelected = selectedNode && selectedNode.id === node.id;
        if (node.isSeed) {
            ctx.beginPath(); ctx.arc(node.x, node.y, r + 12, 0, Math.PI * 2);
            const grad = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, r + 12);
            grad.addColorStop(0, 'rgba(86,156,214,0.3)'); grad.addColorStop(1, 'rgba(86,156,214,0)');
            ctx.fillStyle = grad; ctx.fill();
        }
        if (isSelected) {
            ctx.beginPath(); ctx.arc(node.x, node.y, r + 5, 0, Math.PI * 2);
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.beginPath();
        if (node.type === 'EXTERNAL') { const s = r * 1.4; ctx.rect(node.x - s / 2, node.y - s / 2, s, s); }
        else { ctx.arc(node.x, node.y, r, 0, Math.PI * 2); }
        ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = isSelected ? '#fff' : 'rgba(255,255,255,0.4)';
        ctx.lineWidth = isSelected ? 2.5 : 1; ctx.stroke();
        if (node.type !== 'EXTERNAL') {
            ctx.font = 'bold 8px -apple-system, sans-serif'; ctx.fillStyle = '#fff';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(node.type, node.x, node.y);
        }
        ctx.font = (node.isSeed ? 'bold ' : '') + '10px -apple-system, sans-serif';
        ctx.fillStyle = '#e0e0e0'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        const label = node.name.length > 30 ? node.name.substring(0, 28) + '..' : node.name;
        ctx.fillText(label, node.x, node.y + r + 6);
        if (node.metrics && node.metrics.requestsPerMin > 0) {
            ctx.font = '9px -apple-system, sans-serif'; ctx.fillStyle = HEALTH_COLORS[node.health] || '#888';
            ctx.fillText(node.metrics.requestsPerMin + ' req/m | ' + node.metrics.errorRate.toFixed(1) + '% err', node.x, node.y + r + 18);
        }
    }
    ctx.restore();
    requestAnimationFrame(draw);
}

function screenToWorld(sx, sy) { return { x: (sx - transform.x) / transform.k, y: (sy - transform.y) / transform.k }; }
function findNodeAt(wx, wy) {
    for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i]; const r = getNodeRadius(n) + 4;
        const dx = n.x - wx, dy = n.y - wy;
        if (dx * dx + dy * dy < r * r) return n;
    }
    return null;
}

canvas.addEventListener('mousedown', e => {
    const rect = canvas.getBoundingClientRect();
    const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
    const w = screenToWorld(ox, oy);
    const node = findNodeAt(w.x, w.y);
    if (node) { dragging = node; selectedNode = node; renderDetail(node); }
    else { panning = true; panStart = { x: ox - transform.x, y: oy - transform.y }; }
});

canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
    if (dragging) { const w = screenToWorld(ox, oy); dragging.x = w.x; dragging.y = w.y; }
    else if (panning) { transform.x = ox - panStart.x; transform.y = oy - panStart.y; }
    else {
        const w = screenToWorld(ox, oy);
        const node = findNodeAt(w.x, w.y);
        canvas.style.cursor = node ? 'pointer' : 'default';
        if (node) showTooltip(ox, oy, node);
        else tooltip.style.display = 'none';
    }
});

canvas.addEventListener('mouseup', () => { dragging = null; panning = false; });
canvas.addEventListener('mouseleave', () => { dragging = null; panning = false; tooltip.style.display = 'none'; });

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
    const scale = e.deltaY < 0 ? 1.1 : 0.9;
    const newK = Math.max(0.2, Math.min(4, transform.k * scale));
    transform.x = ox - (ox - transform.x) * (newK / transform.k);
    transform.y = oy - (oy - transform.y) * (newK / transform.k);
    transform.k = newK;
}, { passive: false });

canvas.addEventListener('dblclick', e => {
    const rect = canvas.getBoundingClientRect();
    const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
    const w = screenToWorld(ox, oy);
    const node = findNodeAt(w.x, w.y);
    if (node && node.type !== 'EXTERNAL') vscode.postMessage({ command: 'retrace', appName: node.name });
});

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttrStr(s) { return String(s).replace(/'/g, "\\\\'").replace(/"/g, '&quot;'); }

function showTooltip(x, y, node) {
    let html = '<div class="ct-tt-name">' + escHtml(node.name) + '</div>';
    html += '<div class="ct-tt-row"><span class="ct-tt-label">Type</span><span>' + node.type + '</span></div>';
    html += '<div class="ct-tt-row"><span class="ct-tt-label">Status</span><span>' + node.status + '</span></div>';
    html += '<div class="ct-tt-row"><span class="ct-tt-label">Health</span><span style="color:' + (HEALTH_COLORS[node.health] || '#888') + '">' + node.health + '</span></div>';
    if (node.metrics) {
        const m = node.metrics;
        html += '<div class="ct-tt-row"><span class="ct-tt-label">Requests</span><span>' + m.requestsPerMin + ' req/min</span></div>';
        html += '<div class="ct-tt-row"><span class="ct-tt-label">Error rate</span><span style="color:' + (m.errorRate > 15 ? 'var(--am-error)' : m.errorRate > 5 ? 'var(--am-warning)' : 'var(--am-success)') + '">' + m.errorRate.toFixed(1) + '%</span></div>';
        html += '<div class="ct-tt-row"><span class="ct-tt-label">Avg response</span><span>' + m.avgResponseTimeMs + ' ms</span></div>';
    }
    if (node.type !== 'EXTERNAL') html += '<div class="ct-tt-hint">Double-click to trace from this app</div>';
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    tooltip.style.left = Math.min(x + 16, width - 290) + 'px';
    tooltip.style.top = (y + 16) + 'px';
}

function renderDetail(node) {
    document.getElementById('detailTitle').textContent = node.name;
    document.getElementById('detailSubtitle').textContent = node.type + ' \\u00b7 ' + node.status + (node.isSeed ? ' \\u00b7 Seed' : '');
    const content = document.getElementById('detailContent');
    let html = '';

    html += '<div class="ct-detail-section"><div class="ct-section-title">Live Metrics (15 min)</div>';
    if (node.metrics && node.metrics.totalRequests > 0) {
        const m = node.metrics;
        const errClass = m.errorRate > 15 ? 'ct-failing' : m.errorRate > 5 ? 'ct-degraded' : 'ct-healthy';
        const rtClass = m.avgResponseTimeMs > 5000 ? 'ct-failing' : m.avgResponseTimeMs > 2000 ? 'ct-degraded' : 'ct-healthy';
        html += '<div class="ct-metric-row"><span class="ct-metric-label">Requests/min</span><span class="ct-metric-value">' + m.requestsPerMin + '</span></div>';
        html += '<div class="ct-metric-row"><span class="ct-metric-label">Total requests</span><span class="ct-metric-value">' + m.totalRequests + '</span></div>';
        html += '<div class="ct-metric-row"><span class="ct-metric-label">Failed</span><span class="ct-metric-value ' + errClass + '">' + m.failedRequests + '</span></div>';
        html += '<div class="ct-metric-row"><span class="ct-metric-label">Error rate</span><span class="ct-metric-value ' + errClass + '">' + m.errorRate.toFixed(1) + '%</span></div>';
        html += '<div class="ct-metric-row"><span class="ct-metric-label">Avg response (p75)</span><span class="ct-metric-value ' + rtClass + '">' + m.avgResponseTimeMs + ' ms</span></div>';
    } else {
        html += '<div style="color:var(--am-text-muted);font-size:12px">No metrics available</div>';
    }
    html += '</div>';

    const outgoing = edges.filter(e => e.source === node.id);
    if (outgoing.length > 0) {
        html += '<div class="ct-detail-section"><div class="ct-section-title">Calls (' + outgoing.length + ')</div>';
        for (const edge of outgoing) {
            const target = nodes.find(n => n.id === edge.target);
            html += '<div class="ct-conn-item" onclick="selectNodeById(\\'' + escAttrStr(edge.target) + '\\')">';
            html += '<div class="ct-conn-dot" style="background:' + (HEALTH_COLORS[target ? target.health : 'nodata'] || '#888') + '"></div>';
            html += '<div class="ct-conn-name">' + escHtml(edge.target) + '</div>';
            html += '<div class="ct-conn-method">' + escHtml(edge.discoveryLabel) + '</div></div>';
        }
        html += '</div>';
    }

    const incoming = edges.filter(e => e.target === node.id);
    if (incoming.length > 0) {
        html += '<div class="ct-detail-section"><div class="ct-section-title">Called by (' + incoming.length + ')</div>';
        for (const edge of incoming) {
            const source = nodes.find(n => n.id === edge.source);
            html += '<div class="ct-conn-item" onclick="selectNodeById(\\'' + escAttrStr(edge.source) + '\\')">';
            html += '<div class="ct-conn-dot" style="background:' + (HEALTH_COLORS[source ? source.health : 'nodata'] || '#888') + '"></div>';
            html += '<div class="ct-conn-name">' + escHtml(edge.source) + '</div>';
            html += '<div class="ct-conn-method">' + escHtml(edge.discoveryLabel) + '</div></div>';
        }
        html += '</div>';
    }

    if (outgoing.length === 0 && incoming.length === 0) {
        html += '<div class="ct-detail-section" style="color:var(--am-text-muted);font-size:12px;text-align:center">No direct connections found</div>';
    }

    content.innerHTML = html;
    const actions = document.getElementById('detailActions');
    if (node.type !== 'EXTERNAL') {
        actions.style.display = 'flex';
        const traceBtn = actions.querySelector('.am-btn-primary');
        if (traceBtn) traceBtn.style.display = node.isSeed ? 'none' : '';
    } else { actions.style.display = 'none'; }
}

function selectNodeById(id) {
    const node = nodes.find(n => n.id === id);
    if (node) {
        selectedNode = node; renderDetail(node);
        transform.x = width / 2 - node.x * transform.k;
        transform.y = height / 2 - node.y * transform.k;
    }
}

function traceSelected() { if (selectedNode && selectedNode.type !== 'EXTERNAL') vscode.postMessage({ command: 'retrace', appName: selectedNode.name }); }
function openCommandCenter() { if (selectedNode) vscode.postMessage({ command: 'openCommandCenter', appName: selectedNode.name }); }
function openLogs() { if (selectedNode) vscode.postMessage({ command: 'openLogs', appName: selectedNode.name }); }
function pickDifferentApp() { vscode.postMessage({ command: 'pickApp' }); }

resize();
window.addEventListener('resize', () => { resize(); centerGraph(); });
init();
`;
}

function getTracerStyles(): string {
    return `
        body { overflow: hidden; padding: 0; }
        .ct-page { display: flex; flex-direction: column; height: 100vh; width: 100vw; }

        .ct-header-bar {
            flex-shrink: 0; height: 46px; background: var(--am-bg-surface);
            border-bottom: 1px solid var(--am-border);
            display: flex; align-items: center; padding: 8px 16px; gap: 12px;
        }
        .ct-header-bar h2 { font-size: 14px; font-weight: 600; white-space: nowrap; }
        .ct-env-badge { font-size: 11px; color: var(--am-text-muted); white-space: nowrap; }
        .ct-spacer { flex: 1; }
        .ct-refresh-info { font-size: 11px; color: var(--am-text-muted); white-space: nowrap; display: flex; align-items: center; gap: 4px; }
        .ct-refresh-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--am-success); animation: am-pulse 2s infinite; }

        .ct-main-row { display: flex; flex: 1; min-height: 0; }
        .ct-graph-col { flex: 1; display: flex; flex-direction: column; position: relative; min-width: 0; }
        .ct-canvas-wrap { flex: 1; position: relative; overflow: hidden; }
        canvas { display: block; width: 100%; height: 100%; }

        .ct-summary-bar {
            flex-shrink: 0; height: 38px; background: var(--am-bg-surface);
            border-top: 1px solid var(--am-border);
            display: flex; align-items: center; padding: 6px 16px; gap: 16px; font-size: 12px;
        }
        .ct-stat { display: flex; align-items: center; gap: 4px; }
        .ct-stat-dot { width: 8px; height: 8px; border-radius: 50%; }

        .ct-legend {
            position: absolute; bottom: 12px; left: 16px; z-index: 10;
            background: var(--am-bg-surface); border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md); padding: 10px 12px; font-size: 11px;
        }
        .ct-legend-title { font-weight: 600; margin-bottom: 6px; }
        .ct-legend-item { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
        .ct-legend-color { width: 12px; height: 3px; border-radius: 1px; }

        .ct-detail-sidebar {
            width: 320px; flex-shrink: 0; background: var(--am-bg-surface);
            border-left: 1px solid var(--am-border);
            display: flex; flex-direction: column; overflow: hidden;
        }
        .ct-detail-header { padding: 12px 16px; border-bottom: 1px solid var(--am-border); }
        .ct-detail-header h3 { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
        .ct-detail-subtitle { font-size: 11px; color: var(--am-text-muted); }
        .ct-detail-content { flex: 1; overflow-y: auto; padding: 0; }
        .ct-detail-section { padding: 12px 16px; border-bottom: 1px solid var(--am-border); }
        .ct-section-title { font-size: 11px; color: var(--am-text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; font-weight: 600; }
        .ct-metric-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px; }
        .ct-metric-label { color: var(--am-text-muted); }
        .ct-metric-value { font-weight: 500; }
        .ct-metric-value.ct-healthy { color: var(--am-success); }
        .ct-metric-value.ct-degraded { color: var(--am-warning); }
        .ct-metric-value.ct-failing { color: var(--am-error); }
        .ct-metric-value.ct-nodata { color: var(--am-text-muted); }

        .ct-conn-item {
            padding: 8px 12px; border-radius: var(--am-radius-md); margin-bottom: 4px;
            cursor: pointer; background: var(--am-bg-secondary);
            display: flex; align-items: center; gap: 8px; font-size: 12px; transition: background 0.2s;
        }
        .ct-conn-item:hover { background: var(--am-bg-surface-hover); }
        .ct-conn-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .ct-conn-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ct-conn-method { font-size: 10px; color: var(--am-text-muted); flex-shrink: 0; }

        .ct-detail-actions { padding: 12px 16px; border-top: 1px solid var(--am-border); display: flex; gap: 6px; flex-wrap: wrap; }

        .ct-tooltip {
            position: absolute; background: var(--am-bg-surface); border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md); padding: 10px 12px; font-size: 12px;
            pointer-events: none; display: none; z-index: 30; max-width: 280px;
            box-shadow: var(--am-shadow-lg);
        }
        .ct-tt-name { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
        .ct-tt-row { display: flex; justify-content: space-between; gap: 12px; margin-top: 2px; }
        .ct-tt-label { color: var(--am-text-muted); }
        .ct-tt-hint { margin-top: 6px; font-size: 10px; color: var(--am-text-muted); font-style: italic; border-top: 1px solid var(--am-border); padding-top: 4px; }

        .ct-empty-state {
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            text-align: center; z-index: 5; max-width: 380px;
        }
        .ct-empty-state h3 { font-size: 16px; margin-bottom: 8px; }
        .ct-empty-state p { font-size: 13px; color: var(--am-text-muted); line-height: 1.5; margin-bottom: 12px; }
    `;
}
