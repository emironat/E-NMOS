'use strict';

// ── State ──
const S = {
  data: { nodes:[], senders:[], receivers:[], devices:[], flows:[] },
  open: new Set(),
  sel:  { type:null, id:null },
  search: '',
  autoTimer: null,
  lastFetch: null,
  apiBase: '',
};

// ── DOM refs ──
const ipInput     = document.getElementById('ip-input');
const btnQuery    = document.getElementById('btn-query');
const btnAuto     = document.getElementById('btn-auto');
const treeBody    = document.getElementById('tree-body');
const detailPanel = document.getElementById('detail-panel');
const statusPill  = document.getElementById('status-pill');
const statusText  = document.getElementById('status-text');
const chipsEl     = document.getElementById('chips');
const tsEl        = document.getElementById('ts');
const searchEl    = document.getElementById('search');

// Pre-fill from popup
const urlParam = new URLSearchParams(window.location.search).get('base');
if (urlParam) ipInput.value = urlParam;

// ── Resizable panel ──
(function() {
  const handle    = document.getElementById('resize-handle');
  const treePanel = document.querySelector('.tree-panel');
  let dragging = false;
  let startX = 0;
  let startW = 0;

  handle.addEventListener('mousedown', function(e) {
    dragging = true;
    startX   = e.clientX;
    startW   = treePanel.offsetWidth;
    handle.classList.add('active');
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    const diff = e.clientX - startX;
    const newW = Math.max(150, Math.min(900, startW + diff));
    treePanel.style.width = newW + 'px';
  });

  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('active');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    try { chrome.storage.local.set({ treeWidth: treePanel.offsetWidth }); } catch(e) {}
  });

  // Restore saved width
  try {
    chrome.storage.local.get('treeWidth', function(data) {
      if (data && data.treeWidth) treePanel.style.width = data.treeWidth + 'px';
    });
  } catch(e) {}
})();

// ── Wire up controls ──
btnQuery.addEventListener('click', doQuery);
ipInput.addEventListener('keydown', e => { if (e.key === 'Enter') doQuery(); });
searchEl.addEventListener('input', () => { S.search = searchEl.value.toLowerCase(); renderTree(); });

const toggleDevBtn = document.getElementById('toggle-devices-btn');
let devicesCollapsed = false;
toggleDevBtn.addEventListener('click', () => {
  devicesCollapsed = !devicesCollapsed;
  if (devicesCollapsed) {
    (S.data.devices || []).forEach(d => {
      S.open.delete(d.id);
      S.open.delete('sg:' + d.id);
      S.open.delete('rg:' + d.id);
    });
    toggleDevBtn.textContent = '⊞ Expand';
    toggleDevBtn.title = 'Expand all devices';
  } else {
    (S.data.devices || []).forEach(d => {
      S.open.add(d.id);
      S.open.add('sg:' + d.id);
      S.open.add('rg:' + d.id);
    });
    toggleDevBtn.textContent = '⊟ Collapse';
    toggleDevBtn.title = 'Collapse all devices';
  }
  renderTree();
});
btnAuto.addEventListener('click', () => {
  if (S.autoTimer) {
    clearInterval(S.autoTimer); S.autoTimer = null;
    btnAuto.classList.remove('on'); btnAuto.textContent = '⟳ AUTO';
  } else {
    doQuery(); S.autoTimer = setInterval(doQuery, 10000);
    btnAuto.classList.add('on'); btnAuto.textContent = '⟳ 10s';
  }
});

// ── Delegated click on tree — NO inline handlers ──
treeBody.addEventListener('click', e => {
  const row = e.target.closest('[data-id]');
  if (!row) return;
  const { id, type, role } = row.dataset;

  if (role === 'toggle') {
    if (S.open.has(id)) S.open.delete(id); else S.open.add(id);
    if (type === 'node' || type === 'device') S.sel = { type, id };
    renderTree();
    if (type === 'node' || type === 'device') { renderDetail(); detailPanel.scrollTop = 0; }
  } else if (role === 'select') {
    S.sel = { type, id };
    renderTree();
    renderDetail();
    detailPanel.scrollTop = 0;
  }
});

// ── Delegated click on detail panel (nav links) ──
detailPanel.addEventListener('click', e => {
  const el = e.target.closest('[data-nav]');
  if (!el) return;
  const [type, ...rest] = el.dataset.nav.split(':');
  const id = rest.join(':');
  S.sel = { type, id };
  S.open.add(id);
  renderTree();
  renderDetail();
  detailPanel.scrollTop = 0;
});

// ── Fetch helpers ──
async function apiFetch(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + url);
  return r.json();
}
async function safe(url) {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch(e) { return []; }
}

// ── Main query ──
async function doQuery() {
  const raw = ipInput.value.trim();
  if (!raw) { ipInput.focus(); return; }
  const base = raw.replace(/\/+$/, '');
  try { chrome.storage.local.set({ lastUrl: raw }); } catch(e) {}
  setStatus('loading', 'QUERYING…');
  btnQuery.disabled = true;

  try {
    // Auto-discover the versioned API base
    let apiBase = base;
    const root = await apiFetch(base);
    if (Array.isArray(root) && root.length && typeof root[0] === 'string') {
      const clean = v => v.replace(/\/$/, '');
      if (root.some(v => clean(v) === 'node' || clean(v) === 'query')) {
        // e.g. /x-nmos → pick node or query
        const pick = root.find(v => clean(v) === 'node') || root.find(v => clean(v) === 'query');
        apiBase = base + '/' + clean(pick);
        const verList = await apiFetch(apiBase);
        if (Array.isArray(verList) && verList.length && typeof verList[0] === 'string' && verList[0].match(/^v\d/)) {
          apiBase = apiBase + '/' + verList.map(clean).sort().reverse()[0];
        }
      } else if (root[0].match(/^v\d/)) {
        // e.g. /x-nmos/node → ["v1.3/"]
        apiBase = base + '/' + root.map(clean).sort().reverse()[0];
      }
      // else already at resource level e.g. ["self/","senders/",...]
    }

    // Detect Node API vs Query API
    let isNodeApi = false, selfNode = null;
    try { const s = await apiFetch(apiBase + '/self'); if (s && s.id) { selfNode = s; isNodeApi = true; } } catch(e) {}

    let nodes=[], senders=[], receivers=[], devices=[], flows=[];
    if (isNodeApi) {
      nodes = [selfNode];
      [senders, receivers, devices, flows] = await Promise.all([
        safe(apiBase+'/senders'), safe(apiBase+'/receivers'),
        safe(apiBase+'/devices'), safe(apiBase+'/flows'),
      ]);
    } else {
      [nodes, senders, receivers, devices, flows] = await Promise.all([
        safe(apiBase+'/nodes'),   safe(apiBase+'/senders'),
        safe(apiBase+'/receivers'), safe(apiBase+'/devices'), safe(apiBase+'/flows'),
      ]);
    }

    S.data = { nodes, senders, receivers, devices, flows };

    // Sort using the grouphint tag — this encodes the device's intended logical order.
    // e.g. "urn:x-nmos:tag:grouphint/v1.0": ["[1,2,3]:aud05"]
    // Parse as [group]:roleNN so we sort by group tuple then role type then number.
    const GROUPHINT = 'urn:x-nmos:tag:grouphint/v1.0';

    function parseGrouphint(r) {
      const tags = r.tags && r.tags[GROUPHINT];
      if (!tags || !tags.length) return null;
      // e.g. "[1,2,3]:aud05"
      const m = tags[0].match(/^\[([^\]]+)\]:([a-z]+)(\d+)$/i);
      if (!m) return null;
      const nums = m[1].split(',').map(Number); // [1,2,3]
      const role = m[2].toLowerCase();           // "aud"
      const idx  = parseInt(m[3], 10);           // 5
      return { nums, role, idx };
    }

    function cmpGrouphint(a, b) {
      const ga = parseGrouphint(a);
      const gb = parseGrouphint(b);
      // items without grouphint go to the end
      if (!ga && !gb) return 0;
      if (!ga) return 1;
      if (!gb) return -1;
      // compare group tuple element by element: [1,2,3] vs [1,2,4]
      for (let i = 0; i < Math.max(ga.nums.length, gb.nums.length); i++) {
        const d = (ga.nums[i] || 0) - (gb.nums[i] || 0);
        if (d !== 0) return d;
      }
      // same group — sort by role type (vid < aud < anc) then number
      const roleOrder = { vid:0, video:0, aud:1, audio:1, anc:2, data:2 };
      const ra = roleOrder[ga.role] ?? 9;
      const rb = roleOrder[gb.role] ?? 9;
      if (ra !== rb) return ra - rb;
      return ga.idx - gb.idx;
    }

    S.data.receivers.sort(cmpGrouphint);
    S.data.senders.sort(cmpGrouphint);
    S.data.devices.sort((a, b) =>
      (a.label||'').localeCompare(b.label||'', undefined, { numeric:true, sensitivity:'base' })
    );
    S.lastFetch = new Date(); S.apiBase = apiBase;

    // Auto-open everything
    S.open.clear();
    nodes.forEach(n => S.open.add(n.id));
    devices.forEach(d => { S.open.add(d.id); S.open.add('sg:'+d.id); S.open.add('rg:'+d.id); });

    setStatus('ok', isNodeApi ? 'NODE API' : 'QUERY API');
    updateChips(); renderTree(); renderDetail();
  } catch(err) {
    setStatus('error', 'ERROR'); chipsEl.style.display = 'none';
    detailPanel.innerHTML = '';
    const box = el('div', 'err-box');
    box.appendChild(txt('div', 'err-title', 'Failed to connect'));
    box.appendChild(txt('div', '', raw));
    box.appendChild(txt('div', '', err.message));
    detailPanel.appendChild(box);
  } finally { btnQuery.disabled = false; }
}

function setStatus(s, t) {
  statusPill.className = 'status-pill s-' + s;
  statusText.textContent = t;
  if (S.lastFetch) tsEl.textContent = 'Last: ' + S.lastFetch.toLocaleTimeString() + ' · ' + S.apiBase;
}
function updateChips() {
  const d = S.data;
  document.getElementById('cnt-nodes').textContent     = d.nodes.length;
  document.getElementById('cnt-devices').textContent   = d.devices.length;
  document.getElementById('cnt-senders').textContent   = d.senders.length;
  document.getElementById('cnt-receivers').textContent = d.receivers.length;
  document.getElementById('cnt-flows').textContent     = d.flows.length;
  chipsEl.style.display = 'flex';
}

// ── DOM helpers — NO innerHTML, pure createElement ──
function el(tag, cls, ...children) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  children.forEach(c => { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return e;
}
function txt(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
}
function span(cls, text) { return txt('span', cls, text); }

// ── TREE RENDER ──
function renderTree() {
  const { nodes, devices, senders, receivers, flows } = S.data;
  treeBody.innerHTML = '';

  if (!nodes.length) {
    treeBody.appendChild(txt('div', 'tree-empty', 'Query a registry to begin'));
    return;
  }

  const q = S.search;
  const frag = document.createDocumentFragment();

  nodes.forEach((node, ni) => {
    const nodeLabel = node.label || node.hostname || shortId(node.id);
    if (q && !JSON.stringify(node).toLowerCase().includes(q)) return;
    const nodeOpen = S.open.has(node.id);
    const nodeSel  = S.sel.type === 'node' && S.sel.id === node.id;

    // ── NODE ROW ──
    const nodeRow = mkRow('row-node', node.id, 'node', 'toggle', nodeOpen, nodeSel);
    nodeRow.appendChild(span('n-chev' + (nodeOpen ? ' open' : ''), '▶'));
    nodeRow.appendChild(mkWordBadge('NODE', '#4a9eff', '#162840'));
    const nLbl = txt('span', 'n-lbl', nodeLabel);
    nLbl.title = nodeLabel;
    nodeRow.appendChild(nLbl);
    nodeRow.appendChild(txt('span', 'n-cnt', devices.length + 'd · ' + senders.length + 's · ' + receivers.length + 'r'));
    frag.appendChild(nodeRow);

    if (!nodeOpen) return;

    // Build device→children map
    const devMap = {};
    devices.forEach(d => { devMap[d.id] = { dev: d, senders: [], receivers: [] }; });
    senders.forEach(s => { if (devMap[s.device_id]) devMap[s.device_id].senders.push(s); });
    receivers.forEach(r => { if (devMap[r.device_id]) devMap[r.device_id].receivers.push(r); });
    const knownDevIds = new Set(devices.map(d => d.id));
    const orphanS = senders.filter(s => !knownDevIds.has(s.device_id));
    const orphanR = receivers.filter(r => !knownDevIds.has(r.device_id));

    devices.forEach(dev => {
      const entry   = devMap[dev.id];
      const devOpen = S.open.has(dev.id);
      const devSel  = S.sel.type === 'device' && S.sel.id === dev.id;

      // ── DEVICE ROW ──
      const devRow = mkRow('row-device', dev.id, 'device', 'toggle', devOpen, devSel);
      devRow.appendChild(span('d-chev' + (devOpen ? ' open' : ''), '▶'));
      devRow.appendChild(mkWordBadge('DEVICE', '#9b72f0', '#1e1038'));
      const dLbl = txt('span', 'd-lbl', dev.label || shortId(dev.id));
      dLbl.title = dev.label || dev.id;
      devRow.appendChild(dLbl);
      devRow.appendChild(txt('span', 'd-cnt', entry.senders.length + 's · ' + entry.receivers.length + 'r'));
      frag.appendChild(devRow);

      if (!devOpen) return;

      const sgKey  = 'sg:' + dev.id;
      const rgKey  = 'rg:' + dev.id;
      const sgOpen = S.open.has(sgKey);
      const rgOpen = S.open.has(rgKey);

      // ── SENDERS FOLDER ──
      if (entry.senders.length) {
        const sf = mkRow('row-folder', sgKey, 'folder', 'toggle', sgOpen, false);
        sf.appendChild(span('f-chev' + (sgOpen ? ' open' : ''), '▶'));
        sf.appendChild(mkFolderIcon(true));
        sf.appendChild(txt('span', 'f-lbl', 'Senders'));
        sf.appendChild(txt('span', 'f-cnt', String(entry.senders.length)));
        frag.appendChild(sf);

        if (sgOpen) {
          entry.senders.forEach(s => {
            const flow   = flows.find(f => f.id === s.flow_id);
            const fmt    = flow ? formatType(flow.format) : '';
            const active = !!(s.subscription && s.subscription.active);
            const selCls = S.sel.type === 'sender' && S.sel.id === s.id ? ' sel-sender' : '';
            const leaf = mkRow('row-leaf' + selCls, s.id, 'sender', 'select', false, false);
            leaf.appendChild(span('dot ' + (active ? 'dot-s-on' : 'dot-s-off'), ''));
            const sLbl=txt('span','l-lbl',s.label||shortId(s.id));sLbl.title=s.label||s.id;leaf.appendChild(sLbl);
            const sbadges = document.createElement('div');
            sbadges.className = 'leaf-badges';
            if (fmt) sbadges.appendChild(txt('span', 'rb rb-' + fmt, formatLabel(fmt)));
            sbadges.appendChild(mkDirBadge(true, active, fmt));
            leaf.appendChild(sbadges);
            frag.appendChild(leaf);
          });
        }
      }

      // ── RECEIVERS FOLDER ──
      if (entry.receivers.length) {
        const rf = mkRow('row-folder', rgKey, 'folder', 'toggle', rgOpen, false);
        rf.appendChild(span('f-chev' + (rgOpen ? ' open' : ''), '▶'));
        rf.appendChild(mkFolderIcon(false));
        rf.appendChild(txt('span', 'f-lbl', 'Receivers'));
        rf.appendChild(txt('span', 'f-cnt', String(entry.receivers.length)));
        frag.appendChild(rf);

        if (rgOpen) {
          entry.receivers.forEach(r => {
            const fmt    = formatType(r.format || '');
            const active = !!(r.subscription && r.subscription.active);
            const selCls = S.sel.type === 'receiver' && S.sel.id === r.id ? ' sel-receiver' : '';
            const leaf = mkRow('row-leaf' + selCls, r.id, 'receiver', 'select', false, false);
            leaf.appendChild(span('dot ' + (active ? 'dot-r-on' : 'dot-r-off'), ''));
            const rLbl=txt('span','l-lbl',r.label||shortId(r.id));rLbl.title=r.label||r.id;leaf.appendChild(rLbl);
            const rbadges = document.createElement('div');
            rbadges.className = 'leaf-badges';
            if (fmt) rbadges.appendChild(txt('span', 'rb rb-' + fmt, formatLabel(fmt)));
            rbadges.appendChild(mkDirBadge(false, active, fmt));
            leaf.appendChild(rbadges);
            frag.appendChild(leaf);
          });
        }
      }
    });

    // Orphan senders
    if (orphanS.length) {
      const osgKey = 'sg:orphan:' + node.id;
      const osgOpen = S.open.has(osgKey);
      const osf = mkRow('row-folder', osgKey, 'folder', 'toggle', osgOpen, false);
      osf.appendChild(span('f-chev' + (osgOpen ? ' open' : ''), '▶'));
      osf.appendChild(mkFolderIcon(true));
      osf.appendChild(txt('span', 'f-lbl', 'Senders'));
      osf.appendChild(txt('span', 'f-cnt', String(orphanS.length)));
      frag.appendChild(osf);
      if (osgOpen) {
        orphanS.forEach(s => {
          const flow=flows.find(f=>f.id===s.flow_id); const fmt=flow?formatType(flow.format):'';
          const active=!!(s.subscription&&s.subscription.active);
          const selCls=S.sel.type==='sender'&&S.sel.id===s.id?' sel-sender':'';
          const leaf=mkRow('row-leaf'+selCls,s.id,'sender','select',false,false);
          leaf.appendChild(span('dot '+(active?'dot-s-on':'dot-s-off'),''));
          const sLbl2=txt('span','l-lbl',s.label||shortId(s.id));sLbl2.title=s.label||s.id;leaf.appendChild(sLbl2);
          const sbadges2=document.createElement('div');sbadges2.className='leaf-badges';
          if(fmt)sbadges2.appendChild(txt('span','rb rb-'+fmt,formatLabel(fmt)));
          sbadges2.appendChild(mkDirBadge(true,active,fmt));leaf.appendChild(sbadges2);
          frag.appendChild(leaf);
        });
      }
    }

    // Orphan receivers
    if (orphanR.length) {
      const orgKey = 'rg:orphan:' + node.id;
      const orgOpen = S.open.has(orgKey);
      const orf = mkRow('row-folder', orgKey, 'folder', 'toggle', orgOpen, false);
      orf.appendChild(span('f-chev' + (orgOpen ? ' open' : ''), '▶'));
      orf.appendChild(mkFolderIcon(false));
      orf.appendChild(txt('span', 'f-lbl', 'Receivers'));
      orf.appendChild(txt('span', 'f-cnt', String(orphanR.length)));
      frag.appendChild(orf);
      if (orgOpen) {
        orphanR.forEach(r => {
          const fmt=formatType(r.format||''); const active=!!(r.subscription&&r.subscription.active);
          const selCls=S.sel.type==='receiver'&&S.sel.id===r.id?' sel-receiver':'';
          const leaf=mkRow('row-leaf'+selCls,r.id,'receiver','select',false,false);
          leaf.appendChild(span('dot '+(active?'dot-r-on':'dot-r-off'),''));
          const rLbl2=txt('span','l-lbl',r.label||shortId(r.id));rLbl2.title=r.label||r.id;leaf.appendChild(rLbl2);
          const rbadges2=document.createElement('div');rbadges2.className='leaf-badges';
          if(fmt)rbadges2.appendChild(txt('span','rb rb-'+fmt,formatLabel(fmt)));
          rbadges2.appendChild(mkDirBadge(false,active,fmt));leaf.appendChild(rbadges2);
          frag.appendChild(leaf);
        });
      }
    }

    if (ni < nodes.length - 1) frag.appendChild(el('div', 'ndivider'));
  });

  treeBody.appendChild(frag);
}

function mkLetterIcon(letter, size, color, bgColor) {
  const wrap = document.createElement('span');
  wrap.style.flexShrink = '0';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);

  const r = Math.round(size * 0.2);
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', size); bg.setAttribute('height', size);
  bg.setAttribute('rx', r);
  bg.setAttribute('fill', bgColor);
  bg.setAttribute('stroke', color); bg.setAttribute('stroke-width', '1');
  svg.appendChild(bg);

  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('x', size / 2);
  t.setAttribute('y', size / 2);
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('dominant-baseline', 'central');
  t.setAttribute('fill', color);
  t.setAttribute('font-family', "'JetBrains Mono','Fira Code',Consolas,monospace");
  t.setAttribute('font-size', Math.round(size * 0.55));
  t.setAttribute('font-weight', '800');
  t.textContent = letter;
  svg.appendChild(t);

  wrap.appendChild(svg);
  return wrap;
}

// Badge showing NODE or DEVICE as full word pill — option D style
function mkWordBadge(word, color, bgColor) {
  const wrap = document.createElement('span');
  wrap.style.cssText = `display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;border-radius:4px;border:1.2px solid ${color};background:${bgColor};padding:0 7px;height:20px;`;
  const t = document.createElement('span');
  t.style.cssText = `font-family:system-ui,-apple-system,sans-serif;font-size:10px;font-weight:900;color:${color};letter-spacing:0;line-height:1;`;
  t.textContent = word;
  wrap.appendChild(t);
  return wrap;
}

function mkRow(cls, id, type, role, open, sel) {
  const row = document.createElement('div');
  row.className = cls;
  row.dataset.id   = id;
  row.dataset.type = type;
  row.dataset.role = role;
  return row;
}

// Inline SVG icon for sender/receiver folder — matches N/D icon style
function mkFolderIcon(isSender) {
  const wrap = document.createElement('span');
  wrap.className = 'f-ico';
  const color    = isSender ? '#4a9eff' : '#2ec8b8';
  const dimColor = isSender ? '#162840' : '#0c2825';
  const ns = 'http://www.w3.org/2000/svg';
  const S = 18; // same size as N and D icons

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', S); svg.setAttribute('height', S);
  svg.setAttribute('viewBox', '0 0 18 18');

  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width','18'); bg.setAttribute('height','18');
  bg.setAttribute('rx','4');
  bg.setAttribute('fill', dimColor);
  bg.setAttribute('stroke', color); bg.setAttribute('stroke-width','1.2');
  svg.appendChild(bg);

  if (isSender) {
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx','4'); dot.setAttribute('cy','9'); dot.setAttribute('r','2');
    dot.setAttribute('fill', color);
    svg.appendChild(dot);
    const w1 = document.createElementNS(ns, 'path');
    w1.setAttribute('d','M7,4 Q13,9 7,14');
    w1.setAttribute('fill','none'); w1.setAttribute('stroke',color);
    w1.setAttribute('stroke-width','1.5'); w1.setAttribute('stroke-linecap','round');
    w1.style.animation = 'sw1 1.8s ease-out infinite 0s';
    svg.appendChild(w1);
    const w2 = document.createElementNS(ns, 'path');
    w2.setAttribute('d','M11,1 Q20,9 11,17');
    w2.setAttribute('fill','none'); w2.setAttribute('stroke',color);
    w2.setAttribute('stroke-width','1.1'); w2.setAttribute('stroke-linecap','round');
    w2.style.animation = 'sw1 1.8s ease-out infinite 0.45s';
    svg.appendChild(w2);
  } else {
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx','14'); dot.setAttribute('cy','9'); dot.setAttribute('r','2');
    dot.setAttribute('fill', color);
    svg.appendChild(dot);
    const w1 = document.createElementNS(ns, 'path');
    w1.setAttribute('d','M11,4 Q5,9 11,14');
    w1.setAttribute('fill','none'); w1.setAttribute('stroke',color);
    w1.setAttribute('stroke-width','1.5'); w1.setAttribute('stroke-linecap','round');
    w1.style.animation = 'rw1 1.8s ease-out infinite 0s';
    svg.appendChild(w1);
    const w2 = document.createElementNS(ns, 'path');
    w2.setAttribute('d','M7,1 Q-2,9 7,17');
    w2.setAttribute('fill','none'); w2.setAttribute('stroke',color);
    w2.setAttribute('stroke-width','1.1'); w2.setAttribute('stroke-linecap','round');
    w2.style.animation = 'rw1 1.8s ease-out infinite 0.45s';
    svg.appendChild(w2);
  }

  wrap.appendChild(svg);
  return wrap;
}


// ── Refresh selected item ──
async function refreshSelected() {
  const { type, id } = S.sel;
  if (!type || !id) return;

  const btn = document.getElementById('detail-refresh-btn');
  if (btn) { btn.textContent = '↻ …'; btn.classList.add('spinning'); }

  try {
    // Re-fetch just the relevant endpoint
    const map = { node:'nodes', device:'devices', sender:'senders', receiver:'receivers', flow:'flows' };
    const endpoint = map[type];
    if (!endpoint) return;

    const url = S.apiBase + '/' + endpoint + '/' + id;
    const fresh = await apiFetch(url);

    // Update the item in S.data
    const arr = S.data[endpoint] || S.data[endpoint + 's'];
    const key = Object.keys(S.data).find(k => S.data[k] && Array.isArray(S.data[k]) &&
      S.data[k].some && S.data[k].some(x => x && x.id === id));
    if (key) {
      const idx = S.data[key].findIndex(x => x.id === id);
      if (idx !== -1) S.data[key][idx] = fresh;
    }

    // Re-render detail and tree dot for this item
    renderDetail();
    renderTree();
  } catch(e) {
    console.warn('Refresh failed:', e);
  } finally {
    const b = document.getElementById('detail-refresh-btn');
    if (b) { b.textContent = '↻ Refresh'; b.classList.remove('spinning'); }
  }
}

// Helper to build a refresh button for detail headers
function mkRefreshBtn() {
  const btn = document.createElement('button');
  btn.className = 'dh-refresh';
  btn.id = 'detail-refresh-btn';
  btn.textContent = '↻ Refresh';
  btn.addEventListener('click', refreshSelected);
  return btn;
}
function renderDetail() {
  const { type, id } = S.sel;
  detailPanel.innerHTML = '';
  if (!type || !id) {
    const wrap = el('div', 'detail-empty');
    wrap.appendChild(txt('div', 'detail-empty-icon', '◎'));
    wrap.appendChild(txt('div', 'detail-empty-title', 'Nothing selected'));
    wrap.appendChild(txt('div', 'detail-empty-sub', 'Click any item in the tree to inspect it.'));
    detailPanel.appendChild(wrap);
    return;
  }
  if (type === 'node')     dNode(S.data.nodes.find(n => n.id === id));
  if (type === 'device')   dDevice(S.data.devices.find(d => d.id === id));
  if (type === 'sender')   dSender(S.data.senders.find(s => s.id === id));
  if (type === 'receiver') dReceiver(S.data.receivers.find(r => r.id === id));
}

// nav link helper
function navLink(type, id, label, color) {
  const s = document.createElement('span');
  s.className = 'clickable';
  s.dataset.nav = type + ':' + id;
  s.style.color = color;
  s.textContent = '↑ ' + label;
  return s;
}

function badge(cls, text) { return txt('span', 'badge ' + cls, text); }

function kvRow(key, valueEl) {
  const tr = document.createElement('tr');
  tr.appendChild(txt('td', 'kk', key));
  const td = document.createElement('td');
  td.className = 'kv-v';
  if (typeof valueEl === 'string') td.textContent = valueEl;
  else td.appendChild(valueEl);
  tr.appendChild(td);
  return tr;
}

function kvTable(rows) {
  const table = el('table', 'kv');
  rows.forEach(([k, v]) => table.appendChild(kvRow(k, v)));
  return table;
}

function section(title, count, ...children) {
  const sec = el('div', 'section');
  const sh  = el('div', 'sh');
  sh.appendChild(document.createTextNode(title));
  if (count !== null) sh.appendChild(txt('span', 'sh-count', String(count)));
  sec.appendChild(sh);
  children.forEach(c => sec.appendChild(c));
  return sec;
}

function subBox(arrow, labelText, valueEl, statusBadge) {
  const box  = el('div', 'sub-box');
  box.appendChild(txt('span', 'sub-arrow', arrow));
  const info = el('div', '');
  info.style.flex = '1';
  info.appendChild(txt('div', 'sub-lbl', labelText));
  info.appendChild(valueEl);
  box.appendChild(info);
  box.appendChild(statusBadge);
  return box;
}

function srCard(navKey, dotColor, name, sub, badges) {
  const card = el('div', 'sr-card');
  card.dataset.nav = navKey;
  const dot = el('div', 'sr-card-dot');
  dot.style.background = dotColor;
  card.appendChild(dot);
  const info = el('div', 'sr-card-info');
  info.appendChild(txt('div', 'sr-card-name', name));
  info.appendChild(txt('div', 'sr-card-sub', sub));
  card.appendChild(info);
  const bw = el('div', 'sr-card-badges');
  badges.forEach(b => { if (b) bw.appendChild(b); });
  card.appendChild(bw);
  return card;
}

// ── NODE DETAIL ──
function dNode(n) {
  if (!n) return;
  const clocks   = n.clocks || [];
  const endpoints= (n.api && n.api.endpoints) || [];
  const versions = (n.api && n.api.versions) || [];
  const devs = S.data.devices;
  const ns   = S.data.senders;
  const nr   = S.data.receivers;

  const dh = el('div', 'dh');
  dh.appendChild(mkLetterIcon('N', 44, '#4a9eff', '#162840'));
  const dhInfo = el('div', 'dh-info');
  dhInfo.appendChild(txt('div', 'dh-title', n.label || n.hostname || shortId(n.id)));
  const meta = el('div', 'dh-meta');
  meta.appendChild(document.createTextNode(n.hostname || ''));
  meta.appendChild(badge('b-node', devs.length + ' devices'));
  meta.appendChild(badge('b-sender', ns.length + ' senders'));
  meta.appendChild(badge('b-receiver', nr.length + ' receivers'));
  if (clocks.some(c => c.ref_type === 'ptp' && c.traceable)) meta.appendChild(badge('b-ptp', 'PTP'));
  dhInfo.appendChild(meta);
  dh.appendChild(dhInfo);
  dh.appendChild(mkRefreshBtn());
  detailPanel.appendChild(dh);

  const db = el('div', 'db');

  // Info table
  const verEl = el('span', '');
  versions.forEach(v => { const b = txt('span', 'badge', v); b.style.marginRight = '4px'; b.style.background = 'var(--bg3)'; b.style.color = 'var(--text1)'; verEl.appendChild(b); });
  const hrefLink = document.createElement('a');
  hrefLink.href = n.href || ''; hrefLink.target = '_blank'; hrefLink.textContent = n.href || '—';
  db.appendChild(section('Node info', null, kvTable([
    ['ID', n.id || '—'], ['Label', n.label || '—'], ['Description', n.description || '—'],
    ['Hostname', n.hostname || '—'], ['API versions', verEl], ['href', hrefLink], ['Version', n.version || '—'],
  ])));

  // Clocks
  if (clocks.length) {
    const ct = el('table', 'kv');
    clocks.forEach(c => {
      const valEl = el('span', '');
      valEl.appendChild(badge(c.ref_type === 'ptp' ? 'b-ptp' : 'b-inactive', c.ref_type || 'internal'));
      valEl.appendChild(document.createTextNode(' '));
      valEl.appendChild(badge(c.traceable ? 'b-active' : 'b-inactive', c.traceable ? 'traceable' : 'not traceable'));
      if (c.gmid) { const g = txt('span', '', ' GM: ' + c.gmid); g.style.color = 'var(--text2)'; g.style.fontSize = '11px'; valEl.appendChild(g); }
      ct.appendChild(kvRow(c.name || '', valEl));
    });
    db.appendChild(section('Clocks', null, ct));
  }

  // Devices list
  if (devs.length) {
    const grid = el('div', 'sr-grid');
    devs.forEach(d => {
      const ns2 = S.data.senders.filter(s => s.device_id === d.id).length;
      const nr2 = S.data.receivers.filter(r => r.device_id === d.id).length;
      grid.appendChild(srCard('device:'+d.id, 'var(--purple)', d.label || shortId(d.id), ns2 + ' senders · ' + nr2 + ' receivers', [badge('b-device','device')]));
    });
    db.appendChild(section('Devices', devs.length, grid));
  }

  // Endpoints
  if (endpoints.length) {
    const grid = el('div', 'sr-grid');
    endpoints.forEach(ep => {
      const card = el('div', 'sr-card');
      card.appendChild(badge('', (ep.protocol || 'http').toUpperCase()));
      const info = el('div', 'sr-card-info');
      info.appendChild(txt('div', 'sr-card-name', (ep.host || '') + ':' + (ep.port || 80)));
      card.appendChild(info);
      const a = document.createElement('a');
      a.href = (ep.protocol||'http')+'://'+ep.host+':'+ep.port+'/x-nmos/node/';
      a.target = '_blank'; a.textContent = 'open ↗'; a.style.color = 'var(--blue)'; a.style.fontSize = '11px';
      card.appendChild(a);
      grid.appendChild(card);
    });
    db.appendChild(section('API endpoints', null, grid));
  }

  detailPanel.appendChild(db);
}

// ── DEVICE DETAIL ──
function dDevice(d) {
  if (!d) return;
  const ds   = S.data.senders.filter(s => s.device_id === d.id);
  const dr   = S.data.receivers.filter(r => r.device_id === d.id);
  const node = S.data.nodes.find(n => n.id === d.node_id) || (S.data.nodes.length === 1 ? S.data.nodes[0] : null);

  const dh = el('div', 'dh');
  dh.appendChild(mkLetterIcon('D', 44, '#9b72f0', '#1e1038'));
  const dhInfo = el('div', 'dh-info');
  dhInfo.appendChild(txt('div', 'dh-title', d.label || shortId(d.id)));
  const meta = el('div', 'dh-meta');
  if (node) meta.appendChild(navLink('node', node.id, node.label || node.hostname || shortId(node.id), 'var(--blue)'));
  meta.appendChild(badge('b-sender', ds.length + ' senders'));
  meta.appendChild(badge('b-receiver', dr.length + ' receivers'));
  dhInfo.appendChild(meta);
  dh.appendChild(dhInfo);
  dh.appendChild(mkRefreshBtn());
  detailPanel.appendChild(dh);

  const db = el('div', 'db');
  const nodeClickEl = node ? (() => { const s = txt('span', 'clickable', node.label || node.hostname || d.node_id); s.dataset.nav = 'node:' + node.id; s.style.color = 'var(--blue)'; return s; })() : (d.node_id || '—');
  db.appendChild(section('Device info', null, kvTable([
    ['ID', d.id || '—'], ['Label', d.label || '—'], ['Description', d.description || '—'],
    ['Type', d.type || '—'], ['Node', nodeClickEl], ['Version', d.version || '—'],
  ])));

  if (ds.length) {
    const grid = el('div', 'sr-grid');
    ds.forEach(s => {
      const flow = S.data.flows.find(f => f.id === s.flow_id);
      const fmt  = flow ? formatType(flow.format) : '';
      const active = !!(s.subscription && s.subscription.active);
      grid.appendChild(srCard('sender:'+s.id, active?'var(--blue)':'var(--text2)', s.label||shortId(s.id), (active?'ACTIVE':'IDLE')+(fmt?' · '+fmt.toUpperCase():''), [fmt?badge('b-'+fmt,fmt):null, badge(active?'b-active':'b-inactive',active?'▶':'—')]));
    });
    db.appendChild(section('Senders', ds.length, grid));
  }

  if (dr.length) {
    const grid = el('div', 'sr-grid');
    dr.forEach(r => {
      const fmt  = formatType(r.format || '');
      const active = !!(r.subscription && r.subscription.active);
      grid.appendChild(srCard('receiver:'+r.id, active?'var(--teal)':'var(--text2)', r.label||shortId(r.id), (active?'ROUTED':'UNROUTED')+(fmt?' · '+fmt.toUpperCase():''), [fmt?badge('b-'+fmt,fmt):null, badge(active?'b-active':'b-inactive',active?'●':'—')]));
    });
    db.appendChild(section('Receivers', dr.length, grid));
  }

  detailPanel.appendChild(db);
}

// ── SENDER DETAIL ──
function dSender(s) {
  if (!s) return;
  const flow   = S.data.flows.find(f => f.id === s.flow_id);
  const active = !!(s.subscription && s.subscription.active);
  const rxId   = s.subscription && s.subscription.receiver_id;
  const rx     = rxId ? S.data.receivers.find(r => r.id === rxId) : null;
  const fmt    = flow ? formatType(flow.format) : '';
  const node   = S.data.nodes.find(n => n.id === s.node_id) || (S.data.nodes.length === 1 ? S.data.nodes[0] : null);
  const dev    = S.data.devices.find(d => d.id === s.device_id);

  const dh = el('div', 'dh');
  dh.appendChild(mkLetterIcon('S', 44, '#4a9eff', '#162840'));
  const dhInfo = el('div', 'dh-info');
  dhInfo.appendChild(txt('div', 'dh-title', s.label || shortId(s.id)));
  const meta = el('div', 'dh-meta');
  meta.appendChild(badge(active ? 'b-active' : 'b-inactive', active ? 'ACTIVE' : 'IDLE'));
  if (fmt) meta.appendChild(badge('b-' + fmt, fmt));
  if (node) meta.appendChild(navLink('node', node.id, node.label||node.hostname||shortId(node.id), 'var(--blue)'));
  if (dev)  meta.appendChild(navLink('device', dev.id, dev.label||shortId(dev.id), 'var(--purple)'));
  dhInfo.appendChild(meta);
  dh.appendChild(dhInfo);
  dh.appendChild(mkRefreshBtn());
  detailPanel.appendChild(dh);

  const db = el('div', 'db');

  // Subscription
  const rxValEl = rxId
    ? (() => {
        const wrap = el('div', '');
        const label = txt('div', 'sub-val clickable', rx ? (rx.label || rxId) : rxId);
        label.dataset.nav = 'receiver:' + rxId;
        wrap.appendChild(label);
        const idLine = txt('div', '', rxId);
        idLine.style.cssText = 'font-size:9px;color:var(--text2);margin-top:3px;word-break:break-all;font-family:var(--mono);letter-spacing:.02em;';
        wrap.appendChild(idLine);
        return wrap;
      })()
    : txt('div', 'sub-none', 'not routed');
  db.appendChild(section('Subscription', null, subBox(active?'→':'⊝', 'Routed to receiver', rxValEl, badge(active?'b-active':'b-inactive', active?'ACTIVE':'INACTIVE'))));

  // Sender info
  const nodeEl = node ? (() => { const v = txt('span', 'clickable', node.label||node.hostname||s.node_id); v.dataset.nav = 'node:' + node.id; v.style.color = 'var(--blue)'; return v; })() : (s.node_id||'—');
  const devEl  = dev  ? (() => { const v = txt('span', 'clickable', dev.label||s.device_id); v.dataset.nav = 'device:' + dev.id; v.style.color = 'var(--purple)'; return v; })() : (s.device_id||'—');
  const mfEl   = s.manifest_href ? (() => { const a = document.createElement('a'); a.href = s.manifest_href; a.target = '_blank'; a.textContent = s.manifest_href; return a; })() : '—';
  db.appendChild(section('Sender info', null, kvTable([
    ['ID', s.id], ['Label', s.label||'—'], ['Description', s.description||'—'],
    ['Node', nodeEl], ['Device', devEl], ['Transport', s.transport||'—'],
    ['Interfaces', (s.interface_bindings||[]).join(', ')||'—'], ['Manifest', mfEl], ['Version', s.version||'—'],
  ])));

  // Flow
  if (flow) {
    const rows = [['Format', badge('b-'+fmt, flow.format||'—')], ['Media type', flow.media_type||'—']];
    if (flow.frame_width)  rows.push(['Resolution', flow.frame_width+'×'+flow.frame_height]);
    if (flow.grain_rate)   rows.push(['Frame rate', flow.grain_rate.numerator+'/'+flow.grain_rate.denominator]);
    if (flow.colorspace)   rows.push(['Colorspace', flow.colorspace]);
    if (flow.transfer_characteristic) rows.push(['Transfer', flow.transfer_characteristic]);
    if (flow.bit_depth)    rows.push(['Bit depth', String(flow.bit_depth)]);
    if (flow.sample_rate)  rows.push(['Sample rate', String(flow.sample_rate.numerator)]);
    if (flow.channels)     rows.push(['Channels', String(flow.channels.length)]);
    db.appendChild(section('Flow', null, kvTable(rows)));
  }

  detailPanel.appendChild(db);
}

// ── RECEIVER DETAIL ──
function dReceiver(r) {
  if (!r) return;
  const fmt    = formatType(r.format || '');
  const active = !!(r.subscription && r.subscription.active);
  const txId   = r.subscription && r.subscription.sender_id;
  const tx     = txId ? S.data.senders.find(s => s.id === txId) : null;
  const node   = S.data.nodes.find(n => n.id === r.node_id) || (S.data.nodes.length === 1 ? S.data.nodes[0] : null);
  const dev    = S.data.devices.find(d => d.id === r.device_id);

  const dh = el('div', 'dh');
  dh.appendChild(mkLetterIcon('R', 44, '#2ec8b8', '#0c2825'));
  const dhInfo = el('div', 'dh-info');
  dhInfo.appendChild(txt('div', 'dh-title', r.label || shortId(r.id)));
  const meta = el('div', 'dh-meta');
  meta.appendChild(badge(active ? 'b-active' : 'b-inactive', active ? 'ROUTED' : 'UNROUTED'));
  if (fmt) meta.appendChild(badge('b-' + fmt, fmt));
  if (node) meta.appendChild(navLink('node', node.id, node.label||node.hostname||shortId(node.id), 'var(--blue)'));
  if (dev)  meta.appendChild(navLink('device', dev.id, dev.label||shortId(dev.id), 'var(--purple)'));
  dhInfo.appendChild(meta);
  dh.appendChild(dhInfo);
  dh.appendChild(mkRefreshBtn());
  detailPanel.appendChild(dh);

  const db = el('div', 'db');

  // Subscription
  const txValEl = txId
    ? (() => {
        const wrap = el('div', '');
        const label = txt('div', 'sub-val clickable', tx ? (tx.label || txId) : txId);
        label.dataset.nav = 'sender:' + txId;
        wrap.appendChild(label);
        const idLine = txt('div', '', txId);
        idLine.style.cssText = 'font-size:9px;color:var(--text2);margin-top:3px;word-break:break-all;font-family:var(--mono);letter-spacing:.02em;';
        wrap.appendChild(idLine);
        return wrap;
      })()
    : (() => {
        // active but no sender_id = routed outside NMOS (e.g. direct multicast config)
        if (active && r.description) {
          const m = r.description.match(/getting\s+([^\s]+)/);
          if (m && m[1] !== '0.0.0.0:0') {
            const wrap = el('div', '');
            const v = txt('div', 'sub-none', 'Non-NMOS source: ' + m[1]);
            v.style.color = 'var(--amber)';
            wrap.appendChild(v);
            const idLine = txt('div', '', 'sender_id: null');
            idLine.style.cssText = 'font-size:9px;color:var(--text2);margin-top:3px;font-family:var(--mono);';
            wrap.appendChild(idLine);
            return wrap;
          }
        }
        return txt('div', 'sub-none', 'no sender routed');
      })();
  db.appendChild(section('Subscription', null, subBox(active?'←':'⊝', 'Receiving from sender', txValEl, badge(active?'b-active':'b-inactive', active?'ACTIVE':'INACTIVE'))));

  // Receiver info
  const nodeEl = node ? (() => { const v = txt('span', 'clickable', node.label||node.hostname||r.node_id||'—'); v.dataset.nav = 'node:' + node.id; v.style.color = 'var(--blue)'; return v; })() : (r.node_id||'—');
  const devEl  = dev  ? (() => { const v = txt('span', 'clickable', dev.label||r.device_id); v.dataset.nav = 'device:' + dev.id; v.style.color = 'var(--purple)'; return v; })() : (r.device_id||'—');
  db.appendChild(section('Receiver info', null, kvTable([
    ['ID', r.id], ['Label', r.label||'—'], ['Description', r.description||'—'],
    ['Node', nodeEl], ['Device', devEl],
    ['Format', badge('b-'+fmt, r.format||'—')],
    ['Transport', r.transport||'—'],
    ['Interfaces', (r.interface_bindings||[]).join(', ')||'—'],
    ['Caps', r.caps&&r.caps.media_types ? r.caps.media_types.join(', ') : '—'],
    ['Version', r.version||'—'],
  ])));

  // If routed, show sender details inline
  if (tx) {
    const mfEl = tx.manifest_href ? (() => { const a = document.createElement('a'); a.href = tx.manifest_href; a.target = '_blank'; a.textContent = tx.manifest_href; return a; })() : '—';
    const txIdEl = (() => { const v = txt('span', 'clickable', txId); v.dataset.nav = 'sender:' + txId; v.style.color = 'var(--blue)'; return v; })();
    db.appendChild(section('Routed sender', null, kvTable([
      ['Sender ID', txIdEl], ['Label', tx.label||'—'],
      ['Transport', tx.transport||'—'],
      ['Interfaces', (tx.interface_bindings||[]).join(', ')||'—'],
      ['Manifest', mfEl],
    ])));
  }

  detailPanel.appendChild(db);
}

// ── Helpers ──
function esc(s) { return String(s||''); } // no longer needed for DOM but kept for safety
function shortId(id) { return id ? id.slice(0, 8) + '…' : '—'; }
function formatType(urn) {
  if (!urn) return 'data';
  if (urn.includes('video')) return 'video';
  if (urn.includes('audio')) return 'audio';
  if (urn.includes('mux'))   return 'mux';
  return 'data';
}

function formatLabel(fmt) {
  const map = { video:'VID', audio:'AUD', data:'ANC', mux:'MUX' };
  return map[fmt] || fmt.toUpperCase();
}

// Flowing chevron direction badge — color matches the format badge next to it
function mkDirBadge(isSender, active, fmt) {
  const colorMap = {
    video: { fg:'var(--blue)',   bg:'var(--blue-dim)',   border:'var(--blue)' },
    audio: { fg:'var(--green)',  bg:'var(--green-dim)',  border:'var(--green)' },
    data:  { fg:'var(--amber)',  bg:'var(--amber-dim)',  border:'var(--amber)' },
    mux:   { fg:'var(--purple)', bg:'var(--purple-dim)', border:'var(--purple)' },
  };
  const c = (active && colorMap[fmt]) ? colorMap[fmt] : { fg:'var(--text3)', bg:'none', border:'none' };

  const el = document.createElement('span');
  el.className = 'rb-dir';

  if (active) {
    const chevs = isSender ? ['›','›','›'] : ['‹','‹','‹'];
    const anims = isSender ? ['da1','da2','da3'] : ['da3','da2','da1'];
    chevs.forEach((ch, i) => {
      const s = document.createElement('span');
      s.textContent = ch;
      s.className = anims[i];
      s.style.color = c.fg;
      el.appendChild(s);
    });
  } else {
    const s = document.createElement('span');
    s.textContent = isSender ? '›' : '‹';
    s.style.color   = c.fg;
    s.style.opacity = '0.3';
    el.appendChild(s);
  }
  return el;
}
