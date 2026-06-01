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
  sortMode: {}, // keyed by 'sg:{devId}' or 'rg:{devId}' → 'sorted' | 'api'
  jsonKeys: false, // toggle between friendly labels and raw JSON keys
  lookup: false, // toggle UUID resolution to human labels
  rxSubscribedOnly: false, // show only subscribed (active) receivers in tree
  rxIs05Cache: {}, // receiverId → full IS-05 active object (populated async after query)
  sndIs05Cache: {}, // senderId → full IS-05 active object (populated async after query)
  rxIs05Minimized: {}, // receiverId → true if user has minimized the IS-05 box
};

// ── DOM refs ──
const ipInput     = document.getElementById('ip-input');
const btnQuery    = document.getElementById('btn-query');
const btnAuto     = document.getElementById('btn-auto');
const btnBookmark = document.getElementById('btn-bookmark');
const btnBookmarks = document.getElementById('btn-bookmarks');
const bookmarksPanel = document.getElementById('bookmarks-panel');
const bookmarksList  = document.getElementById('bookmarks-list');
document.getElementById('btn-close-bookmarks').addEventListener('click', () => bookmarksPanel.style.display = 'none');

// Close bookmarks panel when clicking outside it
document.addEventListener('click', e => {
  if (bookmarksPanel.style.display !== 'none' &&
      !bookmarksPanel.contains(e.target) &&
      e.target !== btnBookmarks) {
    bookmarksPanel.style.display = 'none';
  }
});

// ── Bookmarks ──
async function loadBookmarks() {
  try {
    const r = await chrome.storage.local.get('enmos_bookmarks');
    return r.enmos_bookmarks || [];
  } catch(e) { return []; }
}

async function saveBookmarks(bms) {
  try { await chrome.storage.local.set({ enmos_bookmarks: bms }); } catch(e) {}
}

async function renderBookmarks() {
  const bms = await loadBookmarks();
  bookmarksList.innerHTML = '';

  // update star button state
  const currentUrl = ipInput.value.trim();
  const isBookmarked = bms.some(b => b.url === currentUrl);
  btnBookmark.textContent = isBookmarked ? '★' : '☆';
  btnBookmark.style.color = isBookmarked ? '#c8a020' : 'var(--text2)';

  if (!bms.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:var(--text2);font-size:10px;padding:8px 0;';
    empty.textContent = 'No bookmarks yet — connect to a device and click ☆ in the URL bar';
    bookmarksList.appendChild(empty);
    return;
  }

  bms.forEach((bm, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg2);border-radius:5px;margin-bottom:6px;border:1px solid var(--border);';

    const icon = document.createElement('span');
    icon.textContent = '📡';
    icon.style.fontSize = '12px';

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';
    const name = document.createElement('div');
    name.style.cssText = 'color:var(--text0);font-size:10px;font-weight:600;margin-bottom:2px;';
    name.textContent = bm.name;
    const url = document.createElement('div');
    url.style.cssText = 'color:var(--text2);font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--mono);';
    url.textContent = bm.url;
    info.appendChild(name);
    info.appendChild(url);

    const connectBtn = document.createElement('button');
    connectBtn.className = 'btn btn-ghost';
    connectBtn.style.cssText = 'font-size:9px;padding:3px 10px;white-space:nowrap;';
    connectBtn.textContent = '▶ Connect';
    connectBtn.addEventListener('mouseenter', () => { connectBtn.style.borderColor='var(--blue)'; connectBtn.style.color='var(--blue)'; });
    connectBtn.addEventListener('mouseleave', () => { connectBtn.style.borderColor=''; connectBtn.style.color=''; });
    connectBtn.addEventListener('click', e => {
      e.stopPropagation();
      ipInput.value = bm.url;
      bookmarksPanel.style.display = 'none';
      // clear tree and detail so user knows something is happening
      treeBody.innerHTML = '<div class="loading-skeleton"><div class="skeleton-line sk-w60"></div><div class="skeleton-line sk-w80"></div><div class="skeleton-line sk-w40"></div><div class="skeleton-line sk-w70"></div></div>';
      detailPanel.innerHTML = '<div class="loading-skeleton" style="padding:40px 20px;"><div class="skeleton-line sk-w90" style="height:24px;margin-bottom:16px;"></div><div class="skeleton-line sk-w60"></div><div class="skeleton-line sk-w80"></div><div class="skeleton-line sk-w50"></div></div>';
      doQuery();
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-ghost';
    delBtn.style.cssText = 'font-size:11px;padding:2px 6px;color:var(--text2);';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', async e => {
      e.stopPropagation();
      const bms2 = await loadBookmarks();
      bms2.splice(i, 1);
      await saveBookmarks(bms2);
      renderBookmarks();
    });

    row.appendChild(icon);
    row.appendChild(info);
    row.appendChild(connectBtn);
    row.appendChild(delBtn);
    bookmarksList.appendChild(row);
  });
}

btnBookmarks.addEventListener('click', () => {
  if (bookmarksPanel.style.display === 'none') {
    renderBookmarks();
    bookmarksPanel.style.display = 'block';
  } else {
    bookmarksPanel.style.display = 'none';
  }
});

btnBookmark.addEventListener('click', async () => {
  const url = ipInput.value.trim();
  if (!url) return;
  const bms = await loadBookmarks();
  const existing = bms.findIndex(b => b.url === url);
  if (existing !== -1) {
    // already bookmarked — remove it
    bms.splice(existing, 1);
    await saveBookmarks(bms);
    btnBookmark.textContent = '☆';
    btnBookmark.style.color = 'var(--text2)';
  } else {
    // auto-name from node label or hostname
    const autoName = S.data.nodes[0]
      ? (S.data.nodes[0].label || S.data.nodes[0].hostname || url)
      : url;
    bms.push({ name: autoName, url });
    await saveBookmarks(bms);
    btnBookmark.textContent = '★';
    btnBookmark.style.color = '#c8a020';
  }
});
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

  // Restore saved width. One-time bump: older builds defaulted to ~400px which
  // clips the full receiver UUID, so nudge any narrow saved width up to 550.
  try {
    chrome.storage.local.get('treeWidth', function(data) {
      if (data && data.treeWidth) {
        const w = data.treeWidth <= 450 ? 550 : data.treeWidth;
        treePanel.style.width = w + 'px';
      }
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
const toggleSubBtn = document.getElementById('toggle-subscribed-btn');
toggleSubBtn.addEventListener('click', () => {
  S.rxSubscribedOnly = !S.rxSubscribedOnly;
  toggleSubBtn.textContent = S.rxSubscribedOnly ? '⊙ All Rx' : '⊙ Subscribed';
  toggleSubBtn.title = S.rxSubscribedOnly ? 'Show all receivers' : 'Show only subscribed receivers';
  toggleSubBtn.classList.toggle('active-filter', S.rxSubscribedOnly);
  renderTree();
});

btnAuto.addEventListener('click', () => {
  if (S.autoTimer) {
    clearInterval(S.autoTimer); S.autoTimer = null;
    btnAuto.classList.remove('on'); btnAuto.textContent = '⟳ AUTO';
  } else {
    doQuery(true); S.autoTimer = setInterval(() => doQuery(true), 10000);
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
  // Auto-expand parent device/folder so the selected row is visible in the tree
  if (type === 'sender' || type === 'receiver') {
    const list = type === 'sender' ? S.data.senders : S.data.receivers;
    const item = list.find(x => x.id === id);
    if (item) {
      S.open.add(item.device_id);
      const folderKey = (type === 'sender' ? 'sg:' : 'rg:') + item.device_id;
      S.open.add(folderKey);
      // Also expand the parent node
      const dev = S.data.devices.find(d => d.id === item.device_id);
      if (dev) S.open.add(dev.node_id);
    }
  } else if (type === 'device') {
    const dev = S.data.devices.find(d => d.id === id);
    if (dev) S.open.add(dev.node_id);
  }
  renderTree();
  renderDetail();
  detailPanel.scrollTop = 0;
});

// ── Fetch helpers ──
// Wraps fetch with an AbortController timeout so a dead device can't hang the UI.
function fetchT(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}
async function apiFetch(url) {
  let r;
  try {
    r = await fetchT(url, { headers: { Accept: 'application/json' } });
  } catch(e) {
    if (e.name === 'AbortError') throw new Error('Timed out — ' + url);
    throw e;
  }
  if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + url);
  return r.json();
}
async function safe(url) {
  try {
    const r = await fetchT(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    const d = await r.json();
    if (Array.isArray(d)) return d;
    // Some registries wrap results in an envelope, e.g. { data: [...] }
    if (d && Array.isArray(d.data)) return d.data;
    if (d && Array.isArray(d.results)) return d.results;
    return [];
  } catch(e) { return []; }
}

// Pick the highest NMOS API version, sorting numerically so v1.10 > v1.9.
function highestVer(list) {
  return list.map(v => String(v).replace(/\/$/, '')).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  ).reverse()[0];
}

// ── Main query ──
async function doQuery(silent = false) {
  const raw = ipInput.value.trim();
  if (!raw) { ipInput.focus(); return; }
  const base = raw.replace(/\/+$/, '');
  try { chrome.storage.local.set({ lastUrl: raw }); } catch(e) {}
  setStatus('loading', 'QUERYING…');
  btnQuery.disabled = true;

  // Only clear UI on manual connects — not on auto-refresh
  if (!silent) {
    S.data = { nodes:[], devices:[], senders:[], receivers:[], flows:[] };
    treeBody.innerHTML = '<div class="loading-skeleton"><div class="skeleton-line sk-w60"></div><div class="skeleton-line sk-w80"></div><div class="skeleton-line sk-w40"></div><div class="skeleton-line sk-w70"></div><div class="skeleton-line sk-w55"></div><div class="skeleton-line sk-w80"></div><div class="skeleton-line sk-w45"></div></div>';
    detailPanel.innerHTML = '<div class="loading-skeleton" style="padding:40px 20px;"><div class="skeleton-line sk-w90" style="height:24px;margin-bottom:16px;"></div><div class="skeleton-line sk-w60"></div><div class="skeleton-line sk-w80"></div><div class="skeleton-line sk-w50"></div><div class="skeleton-line sk-w70"></div><div class="skeleton-line sk-w40"></div></div>';
  }

  try {
    // Resolve the versioned API base. Try the standard Node API path FIRST,
    // since most devices (SNP, SPG, etc.) are single Node APIs even if their
    // root also advertises a query interface.
    let apiBase = base;
    let isNodeApi = false, selfNode = null;

    // Helper: given a base that lists ["v1.0/","v1.3/",...], pick the newest
    // and confirm it's a Node API by fetching /self.
    async function tryNodeBase(nodeRoot) {
      try {
        const vers = await apiFetch(nodeRoot);
        if (Array.isArray(vers) && vers.length && String(vers[0]).match(/^v\d/)) {
          const vb = nodeRoot + '/' + highestVer(vers);
          const s = await apiFetch(vb + '/self');
          if (s && s.id) { selfNode = s; return vb; }
        }
      } catch(e) {}
      return null;
    }

    // 1) If the user already pointed at a versioned base, /self may work directly.
    try {
      const s = await apiFetch(base + '/self');
      if (s && s.id) { selfNode = s; apiBase = base; isNodeApi = true; }
    } catch(e) {}

    // 2) Try the conventional /x-nmos/node/ path on the host.
    if (!isNodeApi) {
      const host = base.replace(/\/x-nmos.*$/, '').replace(/\/+$/, '');
      const nb = await tryNodeBase(host + '/x-nmos/node');
      if (nb) { apiBase = nb; isNodeApi = true; }
    }

    // 3) Walk whatever the root advertises (node first, then query/registry).
    if (!isNodeApi) {
      const root = await apiFetch(base);
      if (Array.isArray(root) && root.length && typeof root[0] === 'string') {
        const clean = v => v.replace(/\/$/, '');
        if (root.some(v => clean(v) === 'node')) {
          const nb = await tryNodeBase(base + '/node');
          if (nb) { apiBase = nb; isNodeApi = true; }
        }
        if (!isNodeApi && root.some(v => clean(v) === 'query')) {
          apiBase = base + '/query';
          const verList = await apiFetch(apiBase);
          if (Array.isArray(verList) && verList.length && String(verList[0]).match(/^v\d/)) {
            apiBase = apiBase + '/' + highestVer(verList);
          }
        } else if (!isNodeApi && String(root[0]).match(/^v\d/)) {
          // Already at /x-nmos/node or /x-nmos/query → ["v1.3/"]
          apiBase = base + '/' + highestVer(root);
          const s = await apiFetch(apiBase + '/self').catch(() => null);
          if (s && s.id) { selfNode = s; isNodeApi = true; }
        }
      }
    }

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
      const raw = tags[0];
      // BCP-002-01: "[1,2,3]:aud05" — numeric tuple + role+idx
      const m1 = raw.match(/^\[([^\]]+)\]:([a-z]+)(\d+)$/i);
      if (m1) {
        return {
          group: m1[1],  // "1,2,3"
          nums: m1[1].split(',').map(Number),
          role: m1[2].toLowerCase(),
          idx: parseInt(m1[3], 10)
        };
      }
      // BCP-002-02: "Group Name:Role Name" — named string format.
      // Split on the LAST colon so group names containing colons stay intact.
      const ci = raw.lastIndexOf(':');
      if (ci > 0) {
        const groupPart = raw.slice(0, ci).trim();
        let rolePart  = raw.slice(ci + 1).trim();
        // Strip a leading "sender"/"receiver" word some vendors prepend
        // (e.g. Telestream SPG: "sender Video1").
        rolePart = rolePart.replace(/^(sender|receiver|tx|rx)\s+/i, '');
        const roleLc = rolePart.toLowerCase();
        // Detect format from the role string. Use 'includes' (not word
        // boundaries) so a glued channel number like "Video1" still matches.
        let roleCode = 'other';
        // Highest-priority signal: SMPTE ST 2110 sub-part suffix in the role/label.
        //   -20 = uncompressed video, -22 = JPEG-XS video,
        //   -30/-31 = PCM/AES3 audio, -40 = ancillary/metadata.
        // Some vendors (e.g. MediaLinks) put the full label as the role string,
        // e.g. "MPU1 S1 ST2110-20 Sender", so keyword checks below would miss it.
        const smpte = roleLc.match(/2110-(\d+)/);
        if (smpte) {
          const sub = parseInt(smpte[1], 10);
          if (sub === 20 || sub === 22)        roleCode = 'video';
          else if (sub === 30 || sub === 31)   roleCode = 'audio';
          else if (sub === 40)                 roleCode = 'anc';
        }
        // Vendor audio shorthand "3x" (MediaLinks) → audio.
        if (roleCode === 'other' && /\b3x\b|-3x/.test(roleLc)) roleCode = 'audio';
        if (roleCode === 'other') {
          if (/vid|video/.test(roleLc))                    roleCode = 'video';
          else if (/aud|audio/.test(roleLc))               roleCode = 'audio';
          else if (/anc|ancillary|data|meta/.test(roleLc)) roleCode = 'anc';
          else if (roleLc[0] === 'v')                       roleCode = 'video';
          else if (roleLc[0] === 'a')                       roleCode = 'audio';
          else if (roleLc[0] === 'd' || roleLc[0] === 'm')  roleCode = 'anc';
        }
        // Channel number for grouping/index. For clean vendor roles like
        // "Video 1" this groups V1+A1+D1 together. But when the role string is a
        // full label (SMPTE-suffix vendors like MediaLinks), trailing digits are
        // spurious ("Sender1", the "20" in "ST2110-20"), so skip channel grouping
        // — the group name itself is the real key.
        const fullLabelRole = !!smpte || /\bsender\b|\breceiver\b/.test(roleLc);
        const numM = fullLabelRole ? null : rolePart.match(/(\d+)\s*$/);
        const chan = numM ? parseInt(numM[1], 10) : 0;
        // When the group is identical across all senders (single-group
        // device like the SPG), the channel number is the real grouping key.
        // Build a synthetic group so channels sort together: "SPG9000#01".
        const groupKey = chan ? groupPart + '#' + String(chan).padStart(4, '0') : groupPart;
        return {
          group: groupKey,
          nums: [],
          role: roleCode,
          idx: chan
        };
      }
      return null;
    }

    function cmpGrouphint(a, b) {
      const ga = parseGrouphint(a);
      const gb = parseGrouphint(b);

      // no grouphint — sort by base label (strip format words) then format type
      if (!ga && !gb) {
        const fmtOrder = (x) => {
          const f = (x.format||'').toLowerCase();
          if (f.includes('video')) return 0;
          if (f.includes('audio')) return 1;
          return 2;
        };
        const baseLabel = (x) => (x.label||'').replace(/,?\s*(video|audio|anc|ancillary|data)[^,]*/i, '').trim();
        const baseCmp = baseLabel(a).localeCompare(baseLabel(b), undefined, {numeric:true, sensitivity:'base'});
        if (baseCmp !== 0) return baseCmp;
        return fmtOrder(a) - fmtOrder(b);
      }
      if (!ga) return 1;
      if (!gb) return -1;

      // Compare group identifier — nums (BCP-002-01) or named string (BCP-002-02)
      if (ga.nums.length && gb.nums.length) {
        const len = Math.max(ga.nums.length, gb.nums.length);
        for (let i = 0; i < len; i++) {
          const d = (ga.nums[i] || 0) - (gb.nums[i] || 0);
          if (d !== 0) return d;
        }
      } else {
        const gc = (ga.group||'').localeCompare(gb.group||'', undefined, {numeric:true, sensitivity:'base'});
        if (gc !== 0) return gc;
      }

      // Same group — sort by role (video < audio < data/anc) then by channel index
      // Supports many vendor role codes:
      // - BCP-002-01 standard: vid/aud/anc
      // - SNP senders: vis (video), aus (audio), ans/das (ancillary)
      // - SNP receivers: vd (video), ad (audio), dd (data)
      // - Legacy short codes: vs/as/ds, video/audio/data, mux
      const roleOrder = {
        vid:0, video:0, vis:0, vs:0, vd:0,
        aud:1, audio:1, aus:1, as:1, ad:1,
        anc:2, ans:2, data:2, das:2, dd:2, ds:2,
        mux:3
      };
      const ra = roleOrder[ga.role] ?? 9;
      const rb = roleOrder[gb.role] ?? 9;
      if (ra !== rb) return ra - rb;
      return ga.idx - gb.idx;
    }

    // Store original API order before sorting
    S.data.receiversApiOrder = [...S.data.receivers];
    S.data.sendersApiOrder   = [...S.data.senders];
    S.data.receivers.sort(cmpGrouphint);
    S.data.senders.sort(cmpGrouphint);
    S.data.devices.sort((a, b) =>
      (a.label||'').localeCompare(b.label||'', undefined, { numeric:true, sensitivity:'base' })
    );
    S.lastFetch = new Date(); S.apiBase = apiBase;

    // Auto-open everything on first load only. On silent auto-refresh, preserve
    // whatever the user has collapsed, but still reveal any newly-appeared resources.
    if (!silent) {
      S.open.clear();
      nodes.forEach(n => S.open.add(n.id));
      devices.forEach(d => { S.open.add(d.id); S.open.add('sg:'+d.id); S.open.add('rg:'+d.id); });
    } else {
      const known = S._seenIds || (S._seenIds = new Set());
      nodes.forEach(n => { if (!known.has(n.id)) { S.open.add(n.id); known.add(n.id); } });
      devices.forEach(d => {
        if (!known.has(d.id)) {
          S.open.add(d.id); S.open.add('sg:'+d.id); S.open.add('rg:'+d.id);
          known.add(d.id);
        }
      });
    }
    // Track all current IDs so the next silent refresh knows what's "new"
    if (!S._seenIds) S._seenIds = new Set();
    nodes.forEach(n => S._seenIds.add(n.id));
    devices.forEach(d => S._seenIds.add(d.id));

    setStatus('ok', isNodeApi ? 'NODE API' : 'QUERY API');
    updateChips(); renderTree(); renderDetail();

    // Background-fetch IS-05 active connection for all active receivers to get multicast IPs
    S.rxIs05Cache = {};
    S.sndIs05Cache = {};
    S.rxIs05Minimized = {};
    const mcastQueryId = (S._mcastQueryId = (S._mcastQueryId || 0) + 1);
    (async () => {
      const urlObj = new URL(S.apiBase);
      const origin = urlObj.protocol + '//' + urlObj.host;
      // detect highest connection API version once
      let connVer = 'v1.1';
      try {
        const vr = await fetch(origin + '/x-nmos/connection/');
        if (vr.ok) {
          const vs = await vr.json();
          const sorted = vs.map(v => v.replace(/\/$/, '')).sort((a,b) => a.localeCompare(b,undefined,{numeric:true})).reverse();
          if (sorted.length) connVer = sorted[0];
        }
      } catch(e) {}
      // Fetch IS-05 active for ALL receivers (active or not) — an idle receiver
      // can still have a configured multicast address, same as senders.
      const allRx = (S.data.receivers || []);

      // Debounced renderTree — wait 300ms after last result before re-rendering
      let renderTimer = null;
      const debouncedRender = () => {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(() => { renderTimer = null; renderTree(); }, 300);
      };

      // fetch in small parallel batches to avoid flooding the device
      const BATCH = 6;
      for (let i = 0; i < allRx.length; i += BATCH) {
        const batch = allRx.slice(i, i + BATCH);
        await Promise.all(batch.map(async r => {
          try {
            const url = origin + '/x-nmos/connection/' + connVer + '/single/receivers/' + r.id + '/active';
            const res = await fetch(url);
            if (!res.ok) return;
            const d = await res.json();
            if (d.transport_params && d.transport_params[0] && d.transport_params[0].multicast_ip) {
              if (S._mcastQueryId !== mcastQueryId) return; // new query fired, discard
              S.rxIs05Cache[r.id] = d;
              debouncedRender();
            }
          } catch(e) {}
        }));
      }

      // Fetch IS-05 active for ALL senders (active or not) — senders have a
      // configured multicast address even when idle.
      const allSnd = S.data.senders || [];
      for (let i = 0; i < allSnd.length; i += BATCH) {
        const batch = allSnd.slice(i, i + BATCH);
        await Promise.all(batch.map(async s => {
          try {
            const url = origin + '/x-nmos/connection/' + connVer + '/single/senders/' + s.id + '/active';
            const res = await fetch(url);
            if (!res.ok) return;
            const d = await res.json();
            const sIp = d.transport_params && d.transport_params[0] &&
                        (d.transport_params[0].destination_ip || d.transport_params[0].multicast_ip);
            if (sIp) {
              if (S._mcastQueryId !== mcastQueryId) return;
              S.sndIs05Cache[s.id] = d;
              debouncedRender();
            }
          } catch(e) {}
        }));
      }

      // Final render once all batches done
      if (S._mcastQueryId === mcastQueryId) {
        if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
        renderTree();
      }
    })();
  } catch(err) {
    setStatus('error', 'ERROR'); chipsEl.style.display = 'none';
    treeBody.innerHTML = '<div style="color:var(--amber);font-size:13px;padding:40px 20px;text-align:center;line-height:2;">⚠<br><span style="font-size:11px;color:var(--amber);">Could not connect</span><br><span style="color:var(--text2);font-size:9px;">' + escapeHtml(err.message||'Check the URL and try again') + '</span></div>';
    detailPanel.innerHTML = '<div style="color:var(--amber);font-size:13px;padding:80px 20px;text-align:center;line-height:2;">⚠<br><span style="font-size:11px;">Could not connect</span><br><span style="color:var(--text2);font-size:9px;">' + escapeHtml(err.message||'Check the URL and try again') + '</span></div>';
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
// Escape any string before it goes into an innerHTML template (defends against
// a malicious node label or error message injecting markup).
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Build a Version cell that shows the raw NMOS "seconds:nanoseconds" value,
// and on hover reveals the real wall-clock time. NMOS timestamps are TAI
// (atomic time, no leap seconds), currently 37s ahead of UTC, so we subtract
// 37 to get true UTC before formatting.
const TAI_UTC_OFFSET = 37; // leap seconds as of 2017-01-01, stable since
function mkVersionEl(version) {
  if (!version) return '—';
  const m = String(version).match(/^(\d+):(\d+)$/);
  if (!m) return version; // not a timestamp — show as-is

  const taiSecs = parseInt(m[1], 10);
  const nanos   = parseInt(m[2], 10);
  const utcMs   = (taiSecs - TAI_UTC_OFFSET) * 1000 + Math.round(nanos / 1e6);
  const d = new Date(utcMs);

  const span = document.createElement('span');
  span.textContent = version;
  span.style.cssText = 'cursor:help;';

  if (isNaN(d.getTime())) { attachHelpTooltip(span, { title:'version', text:'Unrecognized timestamp format.' }); return span; }

  // Human-readable strings
  const local = d.toLocaleString(undefined, {
    year:'numeric', month:'short', day:'numeric',
    hour:'numeric', minute:'2-digit', second:'2-digit', timeZoneName:'short'
  });
  const utc = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

  // Relative time
  const diffMs = Date.now() - utcMs;
  const rel = relTime(diffMs);

  const text =
    'Local:  ' + local + '\n' +
    'UTC:    ' + utc + '\n' +
    'TAI:    ' + taiSecs + ' (+' + TAI_UTC_OFFSET + 's leap)\n' +
    rel;

  attachHelpTooltip(span, { title:'version timestamp', text });
  return span;
}

function relTime(diffMs) {
  const abs = Math.abs(diffMs);
  const future = diffMs < 0;
  const sec = Math.round(abs / 1000);
  const min = Math.round(sec / 60);
  const hr  = Math.round(min / 60);
  const day = Math.round(hr / 24);
  let s;
  if (sec < 60)      s = sec + ' second' + (sec === 1 ? '' : 's');
  else if (min < 60) s = min + ' minute' + (min === 1 ? '' : 's');
  else if (hr < 24)  s = hr + ' hour'    + (hr === 1 ? '' : 's');
  else               s = day + ' day'    + (day === 1 ? '' : 's');
  return future ? 'in ' + s : s + ' ago';
}

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


// ── Inline format summary for tree leaf rows ──
function mkFmtSummary(flow, fmt) {
  if (!flow) {
    const ph = document.createElement('span');
    ph.className = 'fmt-summary fmt-summary-empty';
    return ph;
  }
  let text = '';
  if (fmt === 'video' && flow.frame_width && flow.frame_height) {
    const h = flow.frame_height;
    let fps = '';
    if (flow.grain_rate) {
      const n = flow.grain_rate.numerator;
      const d = flow.grain_rate.denominator || 1;
      fps = (d === 1001 && n === 60000) ? '59.94' :
            (d === 1001 && n === 30000) ? '29.97' :
            (d === 1001 && n === 24000) ? '23.98' :
            (d === 1001) ? (n/d).toFixed(2) : String(n/d);
    }
    text = h + (fps ? 'p' + fps : 'p');
  } else if (fmt === 'audio' && flow.sample_rate) {
    const sr = flow.sample_rate.numerator || flow.sample_rate;
    const khz = (typeof sr === 'number' && sr >= 1000) ? (sr/1000) + 'kHz' : sr + 'Hz';
    const ch = flow.channels ? flow.channels.length + 'ch' : '';
    text = khz + (ch ? ' ' + ch : '');
  }
  if (!text) {
    const ph = document.createElement('span');
    ph.className = 'fmt-summary fmt-summary-empty';
    return ph;
  }
  const el2 = document.createElement('span');
  el2.className = 'fmt-summary';
  el2.textContent = text;
  return el2;
}

// ── Inline route target for tree leaf rows ──
function mkRouteTarget(resource, isSender) {
  const sub = resource.subscription;
  if (!sub || !sub.active) return null;
  const targetId = isSender ? sub.receiver_id : sub.sender_id;
  if (!targetId) return null;
  // Find the target resource to get its label
  let label = '';
  if (isSender) {
    const rx = S.data.receivers.find(r => r.id === targetId);
    label = rx ? (rx.label || shortId(targetId)) : shortId(targetId);
  } else {
    const tx = S.data.senders.find(s => s.id === targetId);
    label = tx ? (tx.label || shortId(targetId)) : shortId(targetId);
  }
  const el2 = document.createElement('span');
  el2.className = 'route-target';
  el2.textContent = (isSender ? '→ ' : '← ') + label;
  el2.title = targetId;
  return el2;
}

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
    if (q) {
      // Match against the node AND any of its devices/senders/receivers,
      // since those live in separate arrays (not nested in the node object).
      const nodeDevIds = new Set(devices.filter(d => d.node_id === node.id || nodes.length === 1).map(d => d.id));
      const hay = JSON.stringify(node).toLowerCase()
        + devices.filter(d => nodeDevIds.has(d.id)).map(d => (d.label||'')+(d.id||'')).join(' ').toLowerCase()
        + senders.filter(s => nodeDevIds.has(s.device_id)).map(s => (s.label||'')+(s.id||'')).join(' ').toLowerCase()
        + receivers.filter(r => nodeDevIds.has(r.device_id)).map(r => (r.label||'')+(r.id||'')).join(' ').toLowerCase();
      if (!hay.includes(q)) return;
    }
    const nodeOpen = S.open.has(node.id);
    const nodeSel  = S.sel.type === 'node' && S.sel.id === node.id;

    // Devices belonging to THIS node. In single Node API mode, all devices
    // belong to the one node (senders/receivers have no node_id in IS-04).
    const multiNode = nodes.length > 1;
    const nodeDevices = multiNode ? devices.filter(d => d.node_id === node.id) : devices.slice();
    const nodeDevIdSet = new Set(nodeDevices.map(d => d.id));
    const nodeSenders   = multiNode ? senders.filter(s => nodeDevIdSet.has(s.device_id))   : senders;
    const nodeReceivers = multiNode ? receivers.filter(r => nodeDevIdSet.has(r.device_id)) : receivers;

    // ── NODE ROW ──
    const nodeRow = mkRow('row-node', node.id, 'node', 'toggle', nodeOpen, nodeSel);
    nodeRow.appendChild(span('n-chev' + (nodeOpen ? ' open' : ''), '▶'));
    nodeRow.appendChild(mkWordBadge('NODE', '#2ec8b8', '#0c2825'));
    const nLbl = txt('span', 'n-lbl', nodeLabel);
    nLbl.title = nodeLabel;
    nodeRow.appendChild(nLbl);
    nodeRow.appendChild(txt('span', 'n-cnt', nodeDevices.length + 'd · ' + nodeSenders.length + 's · ' + nodeReceivers.length + 'r'));
    frag.appendChild(nodeRow);

    if (!nodeOpen) return;

    // Build device→children map (scoped to this node)
    const devMap = {};
    nodeDevices.forEach(d => { devMap[d.id] = { dev: d, senders: [], receivers: [] }; });
    nodeSenders.forEach(s => { if (devMap[s.device_id]) devMap[s.device_id].senders.push(s); });
    nodeReceivers.forEach(r => { if (devMap[r.device_id]) devMap[r.device_id].receivers.push(r); });
    const knownDevIds = new Set(nodeDevices.map(d => d.id));
    const orphanS = nodeSenders.filter(s => !knownDevIds.has(s.device_id));
    const orphanR = nodeReceivers.filter(r => !knownDevIds.has(r.device_id));

    nodeDevices.forEach(dev => {
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
        sf.appendChild(mkSortBtn(sgKey, entry.senders));
        sf.appendChild(el('span','f-spc'));
        sf.appendChild(mkFolderApiBtn('senders'));
        sf.appendChild(txt('span', 'f-cnt', String(entry.senders.length)));        frag.appendChild(sf);

        if (sgOpen) {
          const senderList = S.sortMode[sgKey] === 'api'
            ? (S.data.sendersApiOrder || entry.senders).filter(s => s.device_id === dev.id)
            : entry.senders;
          senderList.forEach(s => {
            const flow   = flows.find(f => f.id === s.flow_id);
            const fmt    = flow ? formatType(flow.format) : '';
            const active = !!(s.subscription && s.subscription.active);
            const selCls = S.sel.type === 'sender' && S.sel.id === s.id ? ' sel-leaf sel-' + (fmt||'mux') : '';
            const leaf = mkRow('row-leaf' + selCls, s.id, 'sender', 'select', false, false);
            leaf.appendChild(span('dot ' + (active ? 'dot-on-'+fmt : 'dot-off-'+fmt), ''));
            const sLbl=txt('span','l-lbl',s.label||shortId(s.id));sLbl.title=s.label||s.id;leaf.appendChild(sLbl);
            appendMcast(leaf, s.id, 'sender', active);
            // Inline format summary
            const fmtSummary = mkFmtSummary(flow, fmt);
            if (fmtSummary) leaf.appendChild(fmtSummary);
            const sbadges = document.createElement('div');
            sbadges.className = 'leaf-badges';
            if (fmt) { const rb = txt('span', 'rb rb-' + fmt, formatLabel(fmt)); if (!active) rb.style.opacity='0.4'; sbadges.appendChild(rb); }
            sbadges.appendChild(mkDirBadge(true, active, fmt));
            leaf.appendChild(sbadges);
            frag.appendChild(leaf);
          });
        }
      }

      // ── RECEIVERS FOLDER ──
      const filteredDevReceivers = S.rxSubscribedOnly
        ? entry.receivers.filter(r => !!(r.subscription && r.subscription.active))
        : entry.receivers;
      if (filteredDevReceivers.length) {
        const rf = mkRow('row-folder', rgKey, 'folder', 'toggle', rgOpen, false);
        rf.appendChild(span('f-chev' + (rgOpen ? ' open' : ''), '▶'));
        rf.appendChild(mkFolderIcon(false));
        rf.appendChild(txt('span', 'f-lbl', 'Receivers'));
        rf.appendChild(mkSortBtn(rgKey, filteredDevReceivers));
        rf.appendChild(el('span','f-spc'));
        rf.appendChild(mkFolderApiBtn('receivers'));
        rf.appendChild(txt('span', 'f-cnt', String(filteredDevReceivers.length)));
        frag.appendChild(rf);

        if (rgOpen) {
          const receiverList = S.sortMode[rgKey] === 'api'
            ? (S.data.receiversApiOrder || filteredDevReceivers).filter(r => r.device_id === dev.id && (!S.rxSubscribedOnly || !!(r.subscription && r.subscription.active)))
            : filteredDevReceivers;
          receiverList.forEach(r => {
            const fmt    = formatType(r.format || '');
            const active = !!(r.subscription && r.subscription.active);
            const selCls = S.sel.type === 'receiver' && S.sel.id === r.id ? ' sel-leaf sel-' + (fmt||'mux') : '';
            const leaf = mkRow('row-leaf' + selCls, r.id, 'receiver', 'select', false, false);
            leaf.appendChild(span('dot ' + (active ? 'dot-on-'+fmt : 'dot-off-'+fmt), ''));
            const rLbl=txt('span','l-lbl',r.label||shortId(r.id));rLbl.title=r.label||r.id;leaf.appendChild(rLbl);
            appendMcast(leaf, r.id, 'receiver', active);
            const rFmt = mkFmtSummary(null, fmt);
            if (rFmt) leaf.appendChild(rFmt);
            const rbadges = document.createElement('div');
            rbadges.className = 'leaf-badges';
            if (fmt) { const rb = txt('span', 'rb rb-' + fmt, formatLabel(fmt)); if (!active) rb.style.opacity='0.4'; rbadges.appendChild(rb); }
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
      osf.appendChild(mkSortBtn(osgKey, orphanS));
      osf.appendChild(el('span', 'f-spc'));
      osf.appendChild(mkFolderApiBtn('senders'));
      osf.appendChild(txt('span', 'f-cnt', String(orphanS.length)));
      frag.appendChild(osf);
      if (osgOpen) {
        orphanS.forEach(s => {
          const flow=flows.find(f=>f.id===s.flow_id); const fmt=flow?formatType(flow.format):'';
          const active=!!(s.subscription&&s.subscription.active);
          const selCls=S.sel.type==='sender'&&S.sel.id===s.id?' sel-leaf sel-'+(fmt||'mux'):'';
          const leaf=mkRow('row-leaf'+selCls,s.id,'sender','select',false,false);
          leaf.appendChild(span('dot '+(active?'dot-on-'+fmt:'dot-off-'+fmt),''));
          const sLbl2=txt('span','l-lbl',s.label||shortId(s.id));sLbl2.title=s.label||s.id;leaf.appendChild(sLbl2);
          appendMcast(leaf, s.id, 'sender', active);
          const fmtSummary2 = mkFmtSummary(flow, fmt);
          if (fmtSummary2) leaf.appendChild(fmtSummary2);
          const sbadges2=document.createElement('div');sbadges2.className='leaf-badges';
          if(fmt){const rb2=txt('span','rb rb-'+fmt,formatLabel(fmt));if(!active)rb2.style.opacity='0.25';sbadges2.appendChild(rb2);}
          sbadges2.appendChild(mkDirBadge(true,active,fmt));
          leaf.appendChild(sbadges2);
          frag.appendChild(leaf);
        });
      }
    }

    // Orphan receivers
    const filteredOrphanR = S.rxSubscribedOnly ? orphanR.filter(r => !!(r.subscription && r.subscription.active)) : orphanR;
    if (filteredOrphanR.length) {
      const orgKey = 'rg:orphan:' + node.id;
      const orgOpen = S.open.has(orgKey);
      const orf = mkRow('row-folder', orgKey, 'folder', 'toggle', orgOpen, false);
      orf.appendChild(span('f-chev' + (orgOpen ? ' open' : ''), '▶'));
      orf.appendChild(mkFolderIcon(false));
      orf.appendChild(txt('span', 'f-lbl', 'Receivers'));
      orf.appendChild(mkSortBtn(orgKey, filteredOrphanR));
      orf.appendChild(el('span', 'f-spc'));
      orf.appendChild(mkFolderApiBtn('receivers'));
      orf.appendChild(txt('span', 'f-cnt', String(filteredOrphanR.length)));
      frag.appendChild(orf);
      if (orgOpen) {
        filteredOrphanR.forEach(r => {
          const fmt=formatType(r.format||''); const active=!!(r.subscription&&r.subscription.active);
          const selCls=S.sel.type==='receiver'&&S.sel.id===r.id?' sel-leaf sel-'+(fmt||'mux'):'';
          const leaf=mkRow('row-leaf'+selCls,r.id,'receiver','select',false,false);
          leaf.appendChild(span('dot '+(active?'dot-on-'+fmt:'dot-off-'+fmt),''));
          const rLbl2=txt('span','l-lbl',r.label||shortId(r.id));rLbl2.title=r.label||r.id;leaf.appendChild(rLbl2);
          appendMcast(leaf, r.id, 'receiver', active);
          const rFmt2 = mkFmtSummary(null, fmt);
          if (rFmt2) leaf.appendChild(rFmt2);
          const rbadges2=document.createElement('div');rbadges2.className='leaf-badges';
          if(fmt){const rb3=txt('span','rb rb-'+fmt,formatLabel(fmt));if(!active)rb3.style.opacity='0.25';rbadges2.appendChild(rb3);}
          rbadges2.appendChild(mkDirBadge(false,active,fmt));leaf.appendChild(rbadges2);
          frag.appendChild(leaf);
        });
      }
    }

    if (ni < nodes.length - 1) frag.appendChild(el('div', 'ndivider'));
  });

  treeBody.appendChild(frag);

  // Auto-scroll the selected row into view (after DOM is in place)
  if (S.sel.id) {
    const selRow = treeBody.querySelector('.sel-leaf, .row-device.sel, .row-node.sel');
    if (selRow) {
      const rowRect = selRow.getBoundingClientRect();
      const treeRect = treeBody.getBoundingClientRect();
      // Only scroll if the row is outside the visible area
      if (rowRect.top < treeRect.top || rowRect.bottom > treeRect.bottom) {
        selRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }
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
  row.className = cls + (sel ? ' sel' : '') + (open ? ' open' : '');
  row.dataset.id   = id;
  row.dataset.type = type;
  row.dataset.role = role;
  return row;
}

// Inline SVG icon for sender/receiver folder — matches N/D icon style
function mkFolderIcon(isSender) {
  const wrap = document.createElement('span');
  wrap.className = 'f-ico';
  const color    = '#e06090';
  const dimColor = '#2e1020';
  const ns = 'http://www.w3.org/2000/svg';
  const SZ = 18;

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', SZ); svg.setAttribute('height', SZ);
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
    const map = { device:'devices', sender:'senders', receiver:'receivers', flow:'flows' };
    const endpoint = map[type];

    let url;
    if (type === 'node') {
      url = S.apiBase + '/self';
    } else {
      if (!endpoint) return;
      url = S.apiBase + '/' + endpoint + '/' + id;
    }
    const fresh = await apiFetch(url);

    // Update the item in S.data
    if (type === 'node') {
      const idx = S.data.nodes.findIndex(n => n.id === id);
      if (idx !== -1) S.data.nodes[idx] = fresh;
    } else {
      const key = Object.keys(S.data).find(k => S.data[k] && Array.isArray(S.data[k]) &&
        S.data[k].some && S.data[k].some(x => x && x.id === id));
      if (key) {
        const idx = S.data[key].findIndex(x => x.id === id);
        if (idx !== -1) S.data[key][idx] = fresh;
      }
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

function mkOpenApiBtn(url) {
  const btn = document.createElement('button');
  btn.className = 'dh-refresh';
  btn.textContent = '↗ Open API';
  btn.title = url;
  btn.addEventListener('click', () => window.open(url, '_blank'));
  return btn;
}
function mkDhActions(url) {
  const w = el('div', 'dh-actions');
  w.appendChild(mkOpenApiBtn(url));
  w.appendChild(mkRefreshBtn());
  return w;
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
  try {
    if (type === 'node')     dNode(S.data.nodes.find(n => n.id === id));
    if (type === 'device')   dDevice(S.data.devices.find(d => d.id === id));
    if (type === 'sender')   dSender(S.data.senders.find(s => s.id === id));
    if (type === 'receiver') dReceiver(S.data.receivers.find(r => r.id === id));
  } catch (e) {
    const err = el('div', '');
    err.style.cssText = 'color:var(--amber);padding:20px;font-size:11px;font-family:var(--mono);';
    err.textContent = '⚠ Error rendering detail: ' + (e.message || e);
    detailPanel.appendChild(err);
    console.error('renderDetail error:', e);
  }
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

// Status badge with a leading dot — active = filled glowing dot, idle = hollow.
// Used on sender/receiver cards so the indicator reads as a state, not a control.
function statusBadge(active, label) {
  const b = el('span', 'badge ' + (active ? 'b-active' : 'b-inactive') + ' badge-status');
  b.appendChild(el('span', 'badge-dot' + (active ? '' : ' badge-dot-idle')));
  b.appendChild(document.createTextNode(label));
  return b;
}

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

// JSON key mappings for sender and receiver fields
const FIELD_KEYS = {
  'ID':'id', 'Label':'label', 'Description':'description', 'Node':'node_id',
  'Device':'device_id', 'Flow':'flow_id', 'Transport':'transport',
  'Interfaces':'interface_bindings', 'Manifest':'manifest_href',
  'Version':'version', 'Caps':'caps', 'Format':'format',
  'Media type':'media_type', 'Resolution':'frame_width',
  'Frame rate':'grain_rate', 'Colorspace':'colorspace',
  'Transfer':'transfer_characteristic', 'Bit depth':'bit_depth',
  'Sample rate':'sample_rate', 'Channels':'channels',
};

// NMOS field descriptions — keyed by either friendly name or raw JSON key
const FIELD_HELP = {
  // Identity
  'id':              { title:'id', text:'A unique fingerprint for this item, like a serial number. No two are the same. The system uses this to find this exact sender, receiver, or device.' },
  'ID':              { title:'id', text:'A unique fingerprint for this item, like a serial number. No two are the same. The system uses this to find this exact sender, receiver, or device.' },
  'label':           { title:'label', text:'The friendly name shown to humans (e.g. "Camera 1" or "Audio Mix Bus"). Two things can share a label — the ID is what makes them unique.' },
  'Label':           { title:'label', text:'The friendly name shown to humans (e.g. "Camera 1" or "Audio Mix Bus"). Two things can share a label — the ID is what makes them unique.' },
  'description':     { title:'description', text:'Extra notes about this item. Some devices use this for handy info — for example, SNP puts the multicast destination address here.' },
  'Description':     { title:'description', text:'Extra notes about this item. Some devices use this for handy info — for example, SNP puts the multicast destination address here.' },
  'version':         { title:'version', text:'Timestamp showing when this item last changed, in "seconds:nanoseconds" since 1970. Updates every time anything about this resource changes.' },
  'Version':         { title:'version', text:'Timestamp showing when this item last changed, in "seconds:nanoseconds" since 1970. Updates every time anything about this resource changes.' },
  'tags':            { title:'tags', text:'Optional labels that devices add for extra info. The most common is "grouphint" — which tells you which video, audio, and data streams belong together as one group.' },
  'Tags':            { title:'tags', text:'Optional labels that devices add for extra info. The most common is "grouphint" — which tells you which video, audio, and data streams belong together as one group.' },
  'Tags (BCP-002-01)':{ title:'tags (BCP-002-01)', text:'Tells you which streams belong together using numbers. Format: [group]:role+number, e.g. [1,1,1]:vid02. Streams with the same [group] are meant to be received together (typically 1 video + 1 audio + 1 ANC).' },
  'Tags (BCP-002-02)':{ title:'tags (BCP-002-02)', text:'Same idea as BCP-002-01 (grouping streams together) but with readable names instead of numbers, e.g. "Camera 1:Video 1".' },

  // Hierarchy references
  'node_id':         { title:'node_id', text:'Which Node this Device belongs to. A Node is the whole piece of equipment — like a camera body, production switcher, or processing card.' },
  'Node':            { title:'node_id', text:'Which Node this Device belongs to. A Node is the whole piece of equipment — like a camera body, production switcher, or processing card.' },
  'device_id':       { title:'device_id', text:'Which Device this Sender or Receiver belongs to. A Device is a logical unit inside a Node — like one camera output or one audio mix.' },
  'Device':          { title:'device_id', text:'Which Device this Sender or Receiver belongs to. A Device is a logical unit inside a Node — like one camera output or one audio mix.' },
  'flow_id':         { title:'flow_id', text:'Which Flow this Sender transmits. A Flow is the actual media content — describes what video, audio, or data is being sent and in what format.' },
  'Flow':            { title:'flow_id', text:'Which Flow this Sender transmits. A Flow is the actual media content — describes what video, audio, or data is being sent and in what format.' },
  'source_id':       { title:'source_id', text:'Which Source this Flow originally came from. A Source is the raw original signal — like the unprocessed output from a camera sensor.' },
  'parents':         { title:'parents', text:'Other Flows this one was created from. Used when a Flow is a converted or processed version of another (like a downscaled or transcoded copy).' },

  // Transport
  'transport':       { title:'transport', text:'How the stream travels over the network. The most common is RTP multicast (used for ST 2110 broadcast). Other options: unicast RTP, websocket, MQTT.' },
  'Transport':       { title:'transport', text:'How the stream travels over the network. The most common is RTP multicast (used for ST 2110 broadcast). Other options: unicast RTP, websocket, MQTT.' },
  'manifest_href':   { title:'manifest_href', text:'A link to the SDP file. SDP is a plain-text file describing everything a receiver needs to play the stream — multicast address, port, codec, PTP clock, etc.' },
  'Manifest':        { title:'manifest_href', text:'A link to the SDP file. SDP is a plain-text file describing everything a receiver needs to play the stream — multicast address, port, codec, PTP clock, etc.' },
  'interface_bindings':{ title:'interface_bindings', text:'Which network ports the stream uses. Two interfaces (e.g. eth2 + eth3) means ST 2022-7 redundancy is on — the stream goes out two paths, so one network failure won\'t take it down.' },
  'Interfaces':      { title:'interface_bindings', text:'Which network ports the stream uses. Two interfaces (e.g. eth2 + eth3) means ST 2022-7 redundancy is on — the stream goes out two paths, so one network failure won\'t take it down.' },
  'subscription':    { title:'subscription', text:'Shows whether this is connected to something. On a Sender: which Receiver is pulling from it. On a Receiver: which Sender it\'s pulling from. Null means not connected via NMOS IS-05.' },
  'Subscription':    { title:'subscription', text:'Shows whether this is connected to something. On a Sender: which Receiver is pulling from it. On a Receiver: which Sender it\'s pulling from. Null means not connected via NMOS IS-05.' },

  // Format
  'format':          { title:'format', text:'What general kind of media this is. Four types: video, audio, data (like closed captions / ANC), and mux (multiplexed streams).' },
  'Format':          { title:'format', text:'What general kind of media this is. Four types: video, audio, data (like closed captions / ANC), and mux (multiplexed streams).' },
  'media_type':      { title:'media_type', text:'The specific format or codec. Examples: video/raw (uncompressed), video/jxsv (JPEG XS compressed), video/smpte291 (ANC data like captions), audio/L24 (24-bit PCM audio).' },
  'Media type':      { title:'media_type', text:'The specific format or codec. Examples: video/raw (uncompressed), video/jxsv (JPEG XS compressed), video/smpte291 (ANC data like captions), audio/L24 (24-bit PCM audio).' },
  'caps':            { title:'caps', text:'What this receiver can accept. Lists the media formats this receiver knows how to decode — like a "supported inputs" list.' },
  'Caps':            { title:'caps', text:'What this receiver can accept. Lists the media formats this receiver knows how to decode — like a "supported inputs" list.' },

  // Video flow specifics
  'frame_width':     { title:'frame_width', text:'How wide the video is, in pixels. 1920 for HD, 3840 for 4K UHD, 7680 for 8K.' },
  'frame_height':    { title:'frame_height', text:'How tall the video is, in pixels. 1080 for HD, 2160 for 4K UHD, 4320 for 8K.' },
  'Resolution':      { title:'frame_width × frame_height', text:'Video size in pixels (width × height). 1920×1080 is HD, 3840×2160 is 4K UHD.' },
  'grain_rate':      { title:'grain_rate', text:'How many frames per second, written as a fraction. 60000/1001 = 59.94 fps (NTSC), 30000/1001 = 29.97 fps, 25/1 = 25 fps (PAL), 24/1 = 24 fps (cinema).' },
  'Frame rate':      { title:'grain_rate', text:'How many frames per second, written as a fraction. 60000/1001 = 59.94 fps (NTSC), 30000/1001 = 29.97 fps, 25/1 = 25 fps (PAL), 24/1 = 24 fps (cinema).' },
  'colorspace':      { title:'colorspace', text:'Which color standard the video uses. BT601 = older SD. BT709 = HD broadcast. BT2020 = 4K UHD and HDR.' },
  'Colorspace':      { title:'colorspace', text:'Which color standard the video uses. BT601 = older SD. BT709 = HD broadcast. BT2020 = 4K UHD and HDR.' },
  'transfer_characteristic':{ title:'transfer_characteristic', text:'How brightness is encoded. SDR is the everyday standard. PQ and HLG are HDR (high dynamic range) — brighter highlights and deeper blacks.' },
  'Transfer':        { title:'transfer_characteristic', text:'How brightness is encoded. SDR is the everyday standard. PQ and HLG are HDR (high dynamic range) — brighter highlights and deeper blacks.' },
  'bit_depth':       { title:'bit_depth', text:'How many bits per color sample. 8-bit = consumer, 10-bit = broadcast standard, 12-bit = mastering / cinema quality.' },
  'Bit depth':       { title:'bit_depth', text:'How many bits per color sample. 8-bit = consumer, 10-bit = broadcast standard, 12-bit = mastering / cinema quality.' },
  'interlace_mode':  { title:'interlace_mode', text:'Whether the video is interlaced (older style, alternating lines per frame) or progressive (modern, full frames). Most current broadcast is progressive.' },
  'components':      { title:'components', text:'Technical details about the color channels (Y, Cb, Cr for video). Usually you don\'t need to read this directly.' },

  // Audio flow specifics
  'sample_rate':     { title:'sample_rate', text:'How many audio samples per second, as a fraction. 48000/1 = 48 kHz is the broadcast standard.' },
  'Sample rate':     { title:'sample_rate', text:'How many audio samples per second, as a fraction. 48000/1 = 48 kHz is the broadcast standard.' },
  'channels':        { title:'channels', text:'List of audio channels and what each one is — L (left), R (right), C (center), LFE (subwoofer), etc. Tells you the speaker layout.' },
  'Channels':        { title:'channels', text:'List of audio channels and what each one is — L (left), R (right), C (center), LFE (subwoofer), etc. Tells you the speaker layout.' },

  // Node specifics
  'hostname':        { title:'hostname', text:'The Node\'s DNS name on the network. May be blank if the Node only uses IP addresses.' },
  'href':            { title:'href', text:'The Node\'s base web address (URL) — where to reach its API.' },
  'api':             { title:'api', text:'Which NMOS API versions this Node supports. IS-04 ranges from v1.0 to v1.3 — newer versions add more features.' },
  'services':        { title:'services', text:'Extra services this Node offers beyond the standard NMOS APIs.' },
  'clocks':          { title:'clocks', text:'The timing references this Node uses — usually PTP (Precision Time Protocol). PTP keeps everything synchronized in IP video systems and is required for ST 2110.' },
  'interfaces':      { title:'interfaces', text:'Network ports on this Node, with their MAC addresses and what they\'re connected to.' },
  'chassis_id':      { title:'chassis_id', text:'The MAC address identifying this Node\'s network chassis (from LLDP). Same across all its ports.' },
  'port_id':         { title:'port_id', text:'The MAC address of this specific network port (from LLDP). Unique per interface — useful for tracing exactly which cable/port a stream uses.' },

  // Device specifics
  'type':            { title:'type', text:'What category of device this is. Common types: "pipeline" (signal processing), "generic" (general purpose), "proxy" (gateway to non-NMOS equipment).' },
  'controls':        { title:'controls', text:'Other APIs this Device offers. The most important one is IS-05 (Connection Management) — that\'s the actual routing / take control interface.' },
  'senders':         { title:'senders (deprecated)', text:'Old way of listing the Sender IDs on this Device. Modern apps should query /senders?device_id={id} instead — this field will go away eventually.' },
  'receivers':       { title:'receivers (deprecated)', text:'Old way of listing the Receiver IDs on this Device. Modern apps should query /receivers?device_id={id} instead — this field will go away eventually.' },
};

function mkJsonToggle() {
  const btn = document.createElement('span');
  const active = S.jsonKeys;
  btn.style.cssText = `font-size:8px;cursor:pointer;padding:2px 7px;border-radius:3px;border:1px solid ${active ? 'var(--blue)' : 'var(--border2)'};color:${active ? 'var(--blue)' : 'var(--text2)'};background:${active ? 'var(--blue-dim)' : 'none'};margin-left:8px;font-family:var(--mono);flex-shrink:0;transition:border-color .15s,color .15s;`;
  btn.textContent = 'JSON keys';
  btn.title = active ? 'Showing raw JSON keys — click for friendly labels' : 'Showing friendly labels — click for JSON keys';
  if (!active) {
    btn.addEventListener('mouseenter', () => { btn.style.borderColor='var(--blue)'; btn.style.color='var(--blue)'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor='var(--border2)'; btn.style.color='var(--text2)'; });
  }
  btn.addEventListener('click', e => {
    e.stopPropagation();
    S.jsonKeys = !S.jsonKeys;
    renderDetail();
  });
  return btn;
}

function mkLookupToggle() {
  const btn = document.createElement('span');
  const active = S.lookup;
  btn.style.cssText = `font-size:8px;cursor:pointer;padding:2px 7px;border-radius:3px;border:1px solid ${active ? 'var(--teal)' : 'var(--border2)'};color:${active ? 'var(--teal)' : 'var(--text2)'};background:${active ? 'var(--teal-dim)' : 'none'};margin-left:6px;font-family:var(--mono);flex-shrink:0;transition:border-color .15s,color .15s;`;
  btn.textContent = '⊕ Lookup';
  btn.title = active ? 'Resolving UUIDs to labels — click for raw UUIDs' : 'Showing raw UUIDs — click to resolve to labels';
  if (!active) {
    btn.addEventListener('mouseenter', () => { btn.style.borderColor='var(--teal)'; btn.style.color='var(--teal)'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor='var(--border2)'; btn.style.color='var(--text2)'; });
  }
  btn.addEventListener('click', e => {
    e.stopPropagation();
    S.lookup = !S.lookup;
    renderDetail();
  });
  return btn;
}

// Returns a DOM element showing "label uuid_short" if lookup ON, else plain UUID
function resolveUuid(uuid, type) {
  if (!uuid) return document.createTextNode('—');
  if (!S.lookup) return document.createTextNode(uuid);
  let item = null;
  if (type === 'device')   item = S.data.devices.find(d => d.id === uuid);
  else if (type === 'flow') item = S.data.flows.find(f => f.id === uuid);
  else if (type === 'sender') item = S.data.senders.find(s => s.id === uuid);
  else if (type === 'receiver') item = S.data.receivers.find(r => r.id === uuid);
  else if (type === 'node') item = S.data.nodes.find(n => n.id === uuid);
  if (!item) return document.createTextNode(uuid);
  const wrap = document.createElement('span');
  const lbl = document.createElement('span');
  lbl.style.cssText = 'color:var(--teal);font-size:13px;font-family:var(--sans);font-weight:600;';
  lbl.textContent = item.label || item.hostname || uuid;
  const u = document.createElement('span');
  u.style.cssText = 'color:#7a8499;font-size:10px;margin-left:8px;font-family:var(--mono);';
  u.textContent = uuid;
  u.title = uuid;
  wrap.appendChild(lbl);
  wrap.appendChild(u);
  return wrap;
}

function kvTable(rows) {
  const table = el('table', 'kv');
  rows.forEach(([k, v]) => {
    const displayKey = (S.jsonKeys && FIELD_KEYS[k]) ? FIELD_KEYS[k] : k;
    const tr = document.createElement('tr');
    const th = txt('td', 'kk', displayKey);
    if (S.jsonKeys && FIELD_KEYS[k]) {
      th.style.color = 'var(--blue)';
      th.style.fontFamily = 'var(--mono)';
    }
    // Attach help tooltip if we have a description for this key
    const help = FIELD_HELP[k] || FIELD_HELP[displayKey];
    if (help) attachHelpTooltip(th, help);
    tr.appendChild(th);
    const td = document.createElement('td');
    td.className = 'kv-v';
    if (v == null) td.textContent = '—';
    else if (typeof v === 'string') {
      td.textContent = v;
      // Mono font for technical strings: UUIDs, URNs, IPs, timestamps, paths
      if (isUuid(v) || v.startsWith('urn:') || v.startsWith('http') ||
          /^\d+:\d+$/.test(v) || /^\d{1,3}\.\d{1,3}\.\d/.test(v) ||
          k === 'ID' || k === 'id' || displayKey === 'id') {
        td.style.fontFamily = 'var(--mono)';
        td.style.fontSize = '12px';
      }
      // Add copy-on-click for UUIDs
      if (isUuid(v) || (k === 'ID' || k === 'id' || displayKey === 'id')) {
        td.classList.add('kv-copyable');
        td.addEventListener('click', () => copyToClipboard(v));
      }
    }
    else if (typeof v === 'number' || typeof v === 'boolean') td.textContent = String(v);
    else if (v instanceof Node) {
      td.appendChild(v);
      // If the node text content looks like a UUID, make it copyable
      const nodeText = v.textContent || '';
      if (isUuid(nodeText)) {
        td.classList.add('kv-copyable');
        td.addEventListener('click', () => copyToClipboard(nodeText));
      }
    }
    else td.textContent = JSON.stringify(v);
    tr.appendChild(td);
    table.appendChild(tr);
  });
  return table;
}

// ═══ Help tooltip system ═══
// Hover any key cell for 1 second → tooltip with NMOS description appears

let helpTooltipEl = null;
let helpHoverTimer = null;
let helpCurrentTarget = null;

function ensureHelpTooltip() {
  if (helpTooltipEl) return;
  helpTooltipEl = document.createElement('div');
  helpTooltipEl.style.cssText = 'position:fixed;display:none;background:var(--bg2);color:var(--text0);border:1px solid var(--blue);border-radius:6px;padding:10px 12px;font-size:11px;font-family:system-ui,-apple-system,sans-serif;line-height:1.5;max-width:420px;z-index:10000;box-shadow:0 8px 28px rgba(0,0,0,0.7);pointer-events:none;opacity:0;transition:opacity .12s ease;';
  document.body.appendChild(helpTooltipEl);
  // Hide on scroll anywhere in the page
  window.addEventListener('scroll', hideHelpTooltip, true);
  window.addEventListener('resize', hideHelpTooltip);
}

function showHelpTooltip(targetEl, help) {
  ensureHelpTooltip();
  helpTooltipEl.innerHTML = '';
  const title = document.createElement('div');
  title.style.cssText = 'color:var(--blue);font-weight:700;margin-bottom:5px;font-family:var(--mono);font-size:10px;letter-spacing:.02em;';
  title.textContent = help.title;
  const body = document.createElement('div');
  body.style.cssText = 'color:var(--text1);font-size:11px;white-space:pre-wrap;';
  body.textContent = help.text;
  helpTooltipEl.appendChild(title);
  helpTooltipEl.appendChild(body);

  // Make visible but transparent so we can measure
  helpTooltipEl.style.display = 'block';
  helpTooltipEl.style.opacity = '0';

  const r = targetEl.getBoundingClientRect();
  const tt = helpTooltipEl.getBoundingClientRect();
  const margin = 8;

  // Default position: below the key, aligned to its left
  let top  = r.bottom + 6;
  let left = r.left;

  // If it would overflow bottom of viewport, put it above
  if (top + tt.height + margin > window.innerHeight) {
    top = r.top - tt.height - 6;
  }
  // Clamp horizontally
  if (left + tt.width + margin > window.innerWidth) {
    left = window.innerWidth - tt.width - margin;
  }
  if (left < margin) left = margin;
  if (top < margin)  top  = margin;

  helpTooltipEl.style.top = top + 'px';
  helpTooltipEl.style.left = left + 'px';
  // Fade in
  requestAnimationFrame(() => { if (helpTooltipEl) helpTooltipEl.style.opacity = '1'; });
}

function hideHelpTooltip() {
  if (helpHoverTimer) { clearTimeout(helpHoverTimer); helpHoverTimer = null; }
  helpCurrentTarget = null;
  if (helpTooltipEl) {
    helpTooltipEl.style.opacity = '0';
    helpTooltipEl.style.display = 'none';
  }
}

function attachHelpTooltip(el, help) {
  el.classList.add('kk-help');
  el.addEventListener('mouseenter', () => {
    helpCurrentTarget = el;
    if (helpHoverTimer) clearTimeout(helpHoverTimer);
    helpHoverTimer = setTimeout(() => {
      // Only show if still hovering this element
      if (helpCurrentTarget === el) showHelpTooltip(el, help);
    }, 1000);
  });
  el.addEventListener('mouseleave', hideHelpTooltip);
}

function section(title, count, ...children) {
  const sec = el('div', 'section');
  const sh  = el('div', 'sh');
  const titleNode = document.createElement('span');
  titleNode.textContent = title;
  sh.appendChild(titleNode);
  if (count !== null) sh.appendChild(txt('span', 'sh-count', String(count)));
  sec.appendChild(sh);
  children.forEach(c => sec.appendChild(c));
  return sec;
}

function sectionWithToggle(title, count, toggleBtns, ...children) {
  const sec = el('div', 'section');
  const sh  = el('div', 'sh');
  const titleNode = document.createElement('span');
  titleNode.textContent = title;
  sh.appendChild(titleNode);
  if (count !== null) sh.appendChild(txt('span', 'sh-count', String(count)));
  // toggleBtns can be a single element or an array
  if (Array.isArray(toggleBtns)) toggleBtns.forEach(b => sh.appendChild(b));
  else sh.appendChild(toggleBtns);
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

function decodeGrouphint(tags) {
  const GROUPHINT = 'urn:x-nmos:tag:grouphint/v1.0';
  const raw = tags && tags[GROUPHINT] && tags[GROUPHINT][0];
  if (!raw) return { label: 'Grouphint', value: '—' };

  // Numeric tuple format: [1,1,1]:vid02 — BCP-002-01
  const m = raw.match(/^\[([^\]]+)\]:([a-z]+)(\d+)$/i);
  if (m) {
    const group = m[1];
    const roleMap = {
      vid:'Video', video:'Video', vis:'Video', vs:'Video', vd:'Video',
      aud:'Audio', audio:'Audio', aus:'Audio', as:'Audio', ad:'Audio',
      anc:'ANC', ans:'ANC', data:'Data', das:'Data', dd:'Data', ds:'Data',
      mux:'Mux'
    };
    const role = roleMap[m[2].toLowerCase()] || m[2];
    const ch = parseInt(m[3], 10);
    return { label: 'Grouphint (BCP-002-01)', value: `${raw} — Group [${group}] · ${role} channel ${ch}` };
  }

  // Named string format: "Slot 09 ID 00:Video 01" — BCP-002-02
  const m2 = raw.match(/^(.+):(.+)$/);
  if (m2) {
    return { label: 'Grouphint (BCP-002-02)', value: `${raw} — Group: ${m2[1].trim()} · ${m2[2].trim()}` };
  }

  return { label: 'Grouphint', value: raw };
}
function mkSortBtn(key, items) {
  const GROUPHINT = 'urn:x-nmos:tag:grouphint/v1.0';
  const sorted = S.sortMode[key] !== 'api';

  // Detect which BCP version is in use by checking the first grouphint tag
  let bcpVersion = null;
  if (items && items.length) {
    for (const x of items) {
      const tag = x.tags && x.tags[GROUPHINT] && x.tags[GROUPHINT][0];
      if (tag) {
        bcpVersion = /^\[[^\]]+\]:[a-z]+\d+$/i.test(tag) ? 'BCP-002-01' : 'BCP-002-02';
        break;
      }
    }
  }

  // The value shown in the right half of the toggle
  let valueText;
  if (!sorted) valueText = 'API order';
  else valueText = bcpVersion || 'Label';

  // Split toggle: "sort" label fused to a colored value.
  const btn = document.createElement('span');
  btn.className = 'sort-toggle';
  const lbl = document.createElement('span');
  lbl.className = 'sort-toggle-lbl';
  lbl.textContent = 'sort';
  const val = document.createElement('span');
  val.className = 'sort-toggle-val' + (sorted ? ' on' : ' api');
  val.textContent = valueText;
  btn.appendChild(lbl);
  btn.appendChild(val);

  btn.title = sorted
    ? `Sorted by ${bcpVersion ? 'grouphint tag (' + bcpVersion + ')' : 'label (no grouphint found)'} — click for API order`
    : 'Showing raw API order — click for sorted order';

  btn.addEventListener('click', e => {
    e.stopPropagation();
    S.sortMode[key] = S.sortMode[key] !== 'api' ? 'api' : 'sorted';
    renderTree();
  });
  return btn;
}

// Small ↗ button on folder rows to open full list URL
function mkFolderApiBtn(endpoint) {
  const btn = document.createElement('span');
  btn.textContent = '↗';
  btn.title = S.apiBase + '/' + endpoint + '/';
  btn.style.cssText = 'font-size:9px;cursor:pointer;padding:2px 6px;border-radius:3px;border:1px solid var(--border2);color:var(--text2);background:none;flex-shrink:0;line-height:1.4;transition:border-color .15s,color .15s;';
  btn.addEventListener('mouseenter', () => { btn.style.borderColor='var(--blue)'; btn.style.color='var(--blue)'; });
  btn.addEventListener('mouseleave', () => { btn.style.borderColor='var(--border2)'; btn.style.color='var(--text2)'; });
  btn.addEventListener('click', e => {
    e.stopPropagation();
    window.open(S.apiBase + '/' + endpoint + '/', '_blank');
  });
  return btn;
}

// Word badge for detail panel headers — NODE, DEVICE, SENDER, RECEIVER
function fmtColor(fmt) {
  if (fmt === 'video') return { fg: '#4a9eff', bg: '#162840' };
  if (fmt === 'audio') return { fg: '#3dba6f', bg: '#122a1e' };
  if (fmt === 'anc' || fmt === 'data') return { fg: '#f0a030', bg: '#2e1e08' };
  if (fmt === 'mux') return { fg: '#9b72f0', bg: '#1e1038' };
  return { fg: '#f0a030', bg: '#2e1e08' }; // default to ANC color for unknown formats
}

function mkDetailBadge(word, color, bgColor, fontSize) {
  const wrap = document.createElement('span');
  wrap.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:8px;background:${bgColor};border:1.5px solid ${color};flex-shrink:0;`;
  const t = document.createElement('span');
  t.style.cssText = `font-family:system-ui,-apple-system,sans-serif;font-size:${fontSize}px;font-weight:900;color:${color};letter-spacing:.5px;line-height:1;text-align:center;`;
  t.textContent = word;
  wrap.appendChild(t);
  return wrap;
}

// ── NODE DETAIL ──
function dNode(n) {
  if (!n) return;
  const clocks   = n.clocks || [];
  const interfaces = n.interfaces || [];
  const endpoints= (n.api && n.api.endpoints) || [];
  const versions = (n.api && n.api.versions) || [];
  const devs = S.data.devices;
  const ns   = S.data.senders;
  const nr   = S.data.receivers;

  const dh = el('div', 'dh');
  dh.appendChild(mkDetailBadge('NODE', '#2ec8b8', '#0c2825', 14));
  const dhInfo = el('div', 'dh-info');
  dhInfo.appendChild(txt('div', 'dh-title', n.label || n.hostname || shortId(n.id)));
  const meta = el('div', 'dh-meta');
  meta.appendChild(document.createTextNode(n.hostname || ''));
  meta.appendChild(badge('b-node', devs.length + ' devices'));
  meta.appendChild(badge('b-sender', ns.length + ' senders'));
  meta.appendChild(badge('b-receiver', nr.length + ' receivers'));
  if (clocks.some(c => c.ref_type === 'ptp' && c.traceable)) meta.appendChild(badge('b-ptp', 'PTP'));
  dhInfo.appendChild(meta);
  const urlEl = txt('div', 'dh-url', S.apiBase + '/self');
  dhInfo.appendChild(urlEl);
  dh.appendChild(dhInfo);
  dh.appendChild(mkDhActions(S.apiBase + '/self'));
  detailPanel.appendChild(dh);

  const db = el('div', 'db');

  // Info table
  const verEl = el('span', '');
  versions.forEach(v => { const b = txt('span', 'badge', v); b.style.marginRight = '4px'; b.style.background = 'var(--bg3)'; b.style.color = 'var(--text1)'; verEl.appendChild(b); });
  const hrefLink = document.createElement('a');
  hrefLink.href = n.href || ''; hrefLink.target = '_blank'; hrefLink.textContent = n.href || '—';
  db.appendChild(section('Node info', null, kvTable([
    ['ID', n.id || '—'], ['Label', n.label || '—'], ['Description', n.description || '—'],
    ['Hostname', n.hostname || '—'], ['API versions', verEl], ['href', hrefLink], ['Version', mkVersionEl(n.version)],
  ])));

  // Asset info — BCP-002-04 asset distinguishing tags (manufacturer, product, serial)
  const tags = n.tags || {};
  const assetRows = [];
  const assetMap = [
    ['urn:x-nmos:tag:asset:manufacturer/v1.0', 'Manufacturer'],
    ['urn:x-nmos:tag:asset:product/v1.0',      'Product'],
    ['urn:x-nmos:tag:asset:instance-id/v1.0',  'Serial / Instance ID'],
    ['urn:x-nmos:tag:asset:model/v1.0',        'Model'],
    ['urn:x-nmos:tag:asset:function/v1.0',     'Function'],
  ];
  assetMap.forEach(([urn, label]) => {
    const val = tags[urn];
    if (Array.isArray(val) && val.length) assetRows.push([label, val.join(', ')]);
  });
  if (assetRows.length) {
    db.appendChild(section('Asset', null, kvTable(assetRows)));
  }

  // Clocks
  if (clocks.length) {
    const ct = el('table', 'kv');
    clocks.forEach(c => {
      const valEl = el('span', '');
      valEl.appendChild(badge(c.ref_type === 'ptp' ? 'b-ptp' : 'b-inactive', c.ref_type || 'internal'));
      // Traceability only applies to PTP clocks, not internal ones
      if (c.ref_type === 'ptp') {
        valEl.appendChild(document.createTextNode(' '));
        valEl.appendChild(badge(c.traceable ? 'b-active' : 'b-inactive', c.traceable ? 'traceable' : 'not traceable'));
      }
      if (c.gmid) { const g = txt('span', '', ' GM: ' + c.gmid); g.style.color = 'var(--text2)'; g.style.fontSize = '11px'; valEl.appendChild(g); }
      ct.appendChild(kvRow(c.name || '', valEl));
    });
    db.appendChild(section('Clocks', null, ct));
  }

  // Interfaces — physical NICs with LLDP chassis/port IDs (for cable tracing)
  if (interfaces.length) {
    const it = el('table', 'kv');
    interfaces.forEach(i => {
      const valEl = el('span', '');
      const parts = [];
      if (i.chassis_id) parts.push('chassis ' + i.chassis_id);
      if (i.port_id)    parts.push('port ' + i.port_id);
      if (i.attached_network_device && i.attached_network_device.chassis_id) {
        parts.push('→ switch ' + i.attached_network_device.chassis_id +
          (i.attached_network_device.port_id ? ' port ' + i.attached_network_device.port_id : ''));
      }
      valEl.textContent = parts.join('  ·  ') || '—';
      valEl.style.fontSize = '11px';
      valEl.style.color = 'var(--text2)';
      valEl.style.fontFamily = 'var(--mono)';
      it.appendChild(kvRow(i.name || '', valEl));
    });
    db.appendChild(section('Interfaces', interfaces.length, it));
  }

  // Devices list
  if (devs.length) {
    const grid = el('div', 'sr-grid');
    devs.forEach(d => {
      const ns2 = S.data.senders.filter(s => s.device_id === d.id).length;
      const nr2 = S.data.receivers.filter(r => r.device_id === d.id).length;
      grid.appendChild(srCard('device:'+d.id, 'var(--text1)', d.label || shortId(d.id), ns2 + ' senders · ' + nr2 + ' receivers', [badge('b-device','device')]));
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
      a.target = '_blank'; a.textContent = 'open ↗'; a.style.color = 'var(--text1)'; a.style.fontSize = '11px';
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
  dh.appendChild(mkDetailBadge('DEVICE', '#ffffff', '#1a1e25', 11));
  const dhInfo = el('div', 'dh-info');
  dhInfo.appendChild(txt('div', 'dh-title', d.label || shortId(d.id)));
  const meta = el('div', 'dh-meta');
  if (node) meta.appendChild(navLink('node', node.id, node.label || node.hostname || shortId(node.id), 'var(--text1)'));
  meta.appendChild(badge('b-sender', ds.length + ' senders'));
  meta.appendChild(badge('b-receiver', dr.length + ' receivers'));
  dhInfo.appendChild(meta);
  const urlEl = txt('div', 'dh-url', S.apiBase + '/devices/' + d.id);
  dhInfo.appendChild(urlEl);
  dh.appendChild(dhInfo);
  dh.appendChild(mkDhActions(S.apiBase + '/devices/' + d.id));
  detailPanel.appendChild(dh);

  const db = el('div', 'db');
  const nodeClickEl = node ? (() => { const s = txt('span', 'clickable', node.label || node.hostname || d.node_id); s.dataset.nav = 'node:' + node.id; s.style.color = 'var(--text1)'; return s; })() : (d.node_id || '—');
  db.appendChild(section('Device info', null, kvTable([
    ['ID', d.id || '—'], ['Label', d.label || '—'], ['Description', d.description || '—'],
    ['Type', d.type || '—'], ['Node', nodeClickEl], ['Version', mkVersionEl(d.version)],
  ])));

  if (ds.length) {
    const grid = el('div', 'sr-grid');
    ds.forEach(s => {
      const flow = S.data.flows.find(f => f.id === s.flow_id);
      const fmt  = flow ? formatType(flow.format) : '';
      const active = !!(s.subscription && s.subscription.active);
      grid.appendChild(srCard('sender:'+s.id, active?'var(--text1)':'var(--text2)', s.label||shortId(s.id), (active?'ACTIVE':'IDLE')+(fmt?' · '+fmt.toUpperCase():''), [fmt?badge('b-'+fmt,fmt):null, statusBadge(active, active?'ACTIVE':'IDLE')]));
    });
    db.appendChild(section('Senders', ds.length, grid));
  }

  if (dr.length) {
    const grid = el('div', 'sr-grid');
    dr.forEach(r => {
      const fmt  = formatType(r.format || '');
      const active = !!(r.subscription && r.subscription.active);
      grid.appendChild(srCard('receiver:'+r.id, active?'var(--teal)':'var(--text2)', r.label||shortId(r.id), (active?'ROUTED':'UNROUTED')+(fmt?' · '+fmt.toUpperCase():''), [fmt?badge('b-'+fmt,fmt):null, statusBadge(active, active?'ROUTED':'UNROUTED')]));
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
  const fmt    = senderFormat(s, S.data.flows);
  const node   = S.data.nodes.find(n => n.id === s.node_id) || (S.data.nodes.length === 1 ? S.data.nodes[0] : null);
  const dev    = S.data.devices.find(d => d.id === s.device_id);

  const dh = el('div', 'dh');
  const sCol = fmtColor(fmt);
  dh.appendChild(mkDetailBadge('SENDER', sCol.fg, sCol.bg, 11));
  const dhInfo = el('div', 'dh-info');
  dhInfo.appendChild(txt('div', 'dh-title', s.label || shortId(s.id)));
  const meta = el('div', 'dh-meta');
  meta.appendChild(badge(active ? 'b-active' : 'b-inactive', active ? 'ACTIVE' : 'IDLE'));
  if (fmt) meta.appendChild(badge('b-' + fmt, fmt));
  if (node) meta.appendChild(navLink('node', node.id, node.label||node.hostname||shortId(node.id), 'var(--text1)'));
  if (dev)  meta.appendChild(navLink('device', dev.id, dev.label||shortId(dev.id), 'var(--text1)'));
  dhInfo.appendChild(meta);
  const urlEl = txt('div', 'dh-url', S.apiBase + '/senders/' + s.id);
  dhInfo.appendChild(urlEl);
  dh.appendChild(dhInfo);
  dh.appendChild(mkDhActions(S.apiBase + '/senders/' + s.id));
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
    : (() => {
        const wrap = el('div', '');
        wrap.appendChild(txt('div', 'sub-none', 'No receiver registered via IS-05'));
        const hint = txt('div', '', active ? 'Stream is active — receiver may be routed outside NMOS' : 'Stream is inactive');
        hint.style.cssText = 'font-size:9px;color:var(--text2);margin-top:3px;font-family:var(--mono);';
        wrap.appendChild(hint);
        return wrap;
      })();
  db.appendChild(section('Subscription', null, subBox(active?'→':'⊝', 'Routed to receiver', rxValEl, badge(active?'b-active':'b-inactive', active?'ACTIVE':'INACTIVE'))));

  // Sender info
  const nodeEl = node
    ? (S.jsonKeys
        ? node.id
        : (() => { const v = txt('span', 'clickable', node.label||node.hostname||s.node_id); v.dataset.nav = 'node:' + node.id; v.style.color = 'var(--text1)'; return v; })())
    : (s.node_id||'—');
  const devEl = dev
    ? (S.jsonKeys
        ? dev.id
        : (() => { const v = txt('span', 'clickable', dev.label||s.device_id); v.dataset.nav = 'device:' + dev.id; v.style.color = 'var(--text1)'; return v; })())
    : (s.device_id||'—');
  const mfEl   = s.manifest_href ? (() => { const a = document.createElement('a'); a.href = s.manifest_href; a.target = '_blank'; a.textContent = s.manifest_href; return a; })() : '—';
  const FRIENDLY_LABELS_S = {
    id: 'ID', label: 'Label', description: 'Description', device_id: 'Device',
    transport: 'Transport', interface_bindings: 'Interfaces',
    manifest_href: 'Manifest', flow_id: 'Flow', tags: 'Tags',
    subscription: 'Subscription', version: 'Version', caps: 'Caps',
  };
  const sRows = [];
  // Friendly view: fixed logical order. JSON-keys view: mirror the raw JSON key order.
  const S_ORDER = ['id', 'label', 'description', 'device_id', 'flow_id', 'format', 'transport',
                   'interface_bindings', 'subscription', 'tags', 'version', 'manifest_href', 'caps'];
  const sKeys = S.jsonKeys
    ? Object.keys(s)
    : [...S_ORDER.filter(k => k in s), ...Object.keys(s).filter(k => !S_ORDER.includes(k))];
  sKeys.forEach(k => {
    if (S.jsonKeys) {
      const v = s[k];
      if (k === 'device_id' && S.lookup) {
        sRows.push([k, resolveUuid(v, 'device')]);
      } else if (k === 'flow_id' && S.lookup) {
        sRows.push([k, resolveUuid(v, 'flow')]);
      } else if (k === 'subscription' && S.lookup && v && v.receiver_id) {
        sRows.push([k, resolveUuid(v.receiver_id, 'receiver')]);
      } else if (k === 'version') {
        sRows.push([k, mkVersionEl(v)]);
      } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') sRows.push([k, String(v)]);
      else if (v === null) sRows.push([k, 'null']);
      else sRows.push([k, JSON.stringify(v)]);
    } else {
      const key = FRIENDLY_LABELS_S[k] || k;
      if (k === 'device_id') {
        sRows.push([key, resolveUuid(s.device_id, 'device')]);
      } else if (k === 'flow_id') {
        sRows.push([key, resolveUuid(s.flow_id, 'flow')]);
      } else if (k === 'interface_bindings') {
        sRows.push([key, (s.interface_bindings||[]).join(', ')||'—']);
      } else if (k === 'manifest_href') {
        sRows.push([key, mfEl]);
      } else if (k === 'tags') {
        const gh = decodeGrouphint(s.tags) || { label: 'Tags', value: '—' };
        const lbl = gh.label || 'Tags';
        const tagsKey = lbl.startsWith('Grouphint') ? 'Tags (' + lbl.replace('Grouphint (','').replace(')','') + ')' : 'Tags';
        sRows.push([tagsKey, gh.value !== '—' ? gh.value : '—']);
      } else if (k === 'subscription') {
        const sub = s.subscription || {};
        if (S.lookup && sub.receiver_id) {
          const wrap = document.createElement('span');
          wrap.appendChild(document.createTextNode((sub.active ? 'Active' : 'Inactive') + ' · receiver '));
          wrap.appendChild(resolveUuid(sub.receiver_id, 'receiver'));
          sRows.push([key, wrap]);
        } else {
          sRows.push([key, (sub.active ? 'Active' : 'Inactive') + (sub.receiver_id ? ' · receiver ' + sub.receiver_id : ' · no receiver')]);
        }
      } else if (k === 'version') {
        sRows.push([key, mkVersionEl(s.version)]);
      } else {
        sRows.push([key, s[k]||'—']);
      }
    }
  });
  db.appendChild(sectionWithToggle('Sender info', null, [mkJsonToggle(), mkLookupToggle()], kvTable(sRows)));

  // Flow
  if (flow) {
    const rows = [
      ['Format', flow.format||'—'],
      ['Media type', flow.media_type||'—']
    ];
    if (flow.frame_width) {
      if (S.jsonKeys) {
        rows.push(['frame_width', String(flow.frame_width)]);
        if (flow.frame_height) rows.push(['frame_height', String(flow.frame_height)]);
      } else {
        rows.push(['Resolution', flow.frame_width+'×'+flow.frame_height]);
      }
    }
    if (flow.grain_rate)   rows.push(['Frame rate', S.jsonKeys ? JSON.stringify(flow.grain_rate) : flow.grain_rate.numerator+'/'+flow.grain_rate.denominator]);
    if (flow.colorspace)   rows.push(['Colorspace', flow.colorspace]);
    if (flow.transfer_characteristic) rows.push(['Transfer', flow.transfer_characteristic]);
    if (flow.bit_depth)    rows.push(['Bit depth', String(flow.bit_depth)]);
    if (flow.sample_rate)  rows.push(['Sample rate', S.jsonKeys ? JSON.stringify(flow.sample_rate) : String(flow.sample_rate.numerator)]);
    if (flow.channels)     rows.push(['Channels', S.jsonKeys ? JSON.stringify(flow.channels) : String(flow.channels.length)]);
    db.appendChild(section('Flow', null, kvTable(rows)));
  }

  // SDP fetch section
  if (s.manifest_href) {
    const sdpWrap = el('div', 'sdp-wrap');
    const sdpBtn = document.createElement('button');
    sdpBtn.textContent = '⬇ Fetch SDP';
    sdpBtn.style.cssText = 'background:var(--teal-dim);border:1px solid var(--teal);border-radius:5px;color:var(--teal);cursor:pointer;font-family:var(--mono);font-size:10px;font-weight:700;padding:5px 12px;margin:8px 0 8px 28px;transition:background .15s,color .15s;display:inline-block;';
    sdpBtn.onmouseover = () => { sdpBtn.style.background='var(--teal)'; sdpBtn.style.color='#000'; };
    sdpBtn.onmouseout  = () => { sdpBtn.style.background='var(--teal-dim)'; sdpBtn.style.color='var(--teal)'; };
    const sdpBox = document.createElement('pre');
    sdpBox.style.cssText = 'display:none;background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:10px;font-size:10px;color:var(--green);overflow-x:auto;white-space:pre;line-height:1.5;margin:0 16px 8px 28px;';
    sdpBtn.addEventListener('click', async () => {
      if (sdpBox.style.display !== 'none') {
        sdpBox.style.display='none';
        sdpBtn.textContent='⬇ Fetch SDP';
        sdpBtn.style.background='var(--teal-dim)'; sdpBtn.style.color='var(--teal)';
        return;
      }
      sdpBtn.textContent = '⏳ Fetching…';
      try {
        const res = await fetch(s.manifest_href);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        sdpBox.textContent = text;
        sdpBox.style.display = 'block';
        sdpBtn.textContent = '▲ Hide SDP';
        sdpBtn.style.background='var(--teal)'; sdpBtn.style.color='#000';
      } catch(e) {
        sdpBox.textContent = 'Error: ' + e.message;
        sdpBox.style.color = 'var(--amber)';
        sdpBox.style.display = 'block';
        sdpBtn.textContent = '▲ Hide SDP';
        sdpBtn.style.background='var(--teal)'; sdpBtn.style.color='#000';
      }
    });
    sdpWrap.appendChild(sdpBtn);
    sdpWrap.appendChild(sdpBox);
    db.appendChild(section('SDP', null, sdpWrap));
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
  const rCol = fmtColor(fmt);
  dh.appendChild(mkDetailBadge('RECEIVER', rCol.fg, rCol.bg, 9));
  const dhInfo = el('div', 'dh-info');
  dhInfo.appendChild(txt('div', 'dh-title', r.label || shortId(r.id)));
  const meta = el('div', 'dh-meta');
  meta.appendChild(badge(active ? 'b-active' : 'b-inactive', active ? 'ROUTED' : 'UNROUTED'));
  if (fmt) meta.appendChild(badge('b-' + fmt, fmt));
  if (node) meta.appendChild(navLink('node', node.id, node.label||node.hostname||shortId(node.id), 'var(--text1)'));
  if (dev)  meta.appendChild(navLink('device', dev.id, dev.label||shortId(dev.id), 'var(--text1)'));
  dhInfo.appendChild(meta);
  const urlEl = txt('div', 'dh-url', S.apiBase + '/receivers/' + r.id);
  dhInfo.appendChild(urlEl);
  dh.appendChild(dhInfo);
  dh.appendChild(mkDhActions(S.apiBase + '/receivers/' + r.id));
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
            // Hint to use IS-05 fetch
            const hint = txt('div', '', '⬇ Check IS-05 Connection below for full sender details');
            hint.style.cssText = 'font-size:9px;color:var(--amber);margin-top:5px;font-family:var(--mono);cursor:pointer;text-decoration:underline;opacity:0.8;';
            hint.addEventListener('click', () => {
              const btn = document.getElementById('is05-conn-btn-' + r.id);
              if (btn) { btn.scrollIntoView({behavior:'smooth', block:'center'}); btn.click(); }
            });
            wrap.appendChild(hint);
            return wrap;
          }
        }
        // active but no description either — still hint IS-05
        if (active) {
          const wrap = el('div', '');
          const idLine = txt('div', 'sub-none', 'sender_id: null — routed outside IS-05');
          idLine.style.color = 'var(--amber)';
          wrap.appendChild(idLine);
          const hint = txt('div', '', '⬇ Check IS-05 Connection below for full sender details');
          hint.style.cssText = 'font-size:9px;color:var(--amber);margin-top:5px;font-family:var(--mono);cursor:pointer;text-decoration:underline;opacity:0.8;';
          hint.addEventListener('click', () => {
            const btn = document.getElementById('is05-conn-btn-' + r.id);
            if (btn) { btn.scrollIntoView({behavior:'smooth', block:'center'}); btn.click(); }
          });
          wrap.appendChild(hint);
          return wrap;
        }
        const wrap2 = el('div', '');
        wrap2.appendChild(txt('div', 'sub-none', 'No sender registered via IS-05'));
        const hint2 = txt('div', '', active ? 'Stream is active — sender may be routed outside NMOS' : 'Stream is inactive');
        hint2.style.cssText = 'font-size:9px;color:var(--text2);margin-top:3px;font-family:var(--mono);';
        wrap2.appendChild(hint2);
        return wrap2;
      })();
  db.appendChild(section('Subscription', null, subBox(active?'←':'⊝', 'Receiving from sender', txValEl, badge(active?'b-active':'b-inactive', active?'ACTIVE':'INACTIVE'))));

  // IS-05 Connection fetch — cache-aware, preserves minimized state
  const connWrap = el('div', 'is05-wrap');
  const connBtn = document.createElement('button');
  connBtn.id = 'is05-conn-btn-' + r.id;
  connBtn.className = 'is05-btn';
  connBtn.style.cssText = 'border-radius:5px;cursor:pointer;font-family:var(--mono);font-size:10px;font-weight:700;padding:5px 12px;margin:8px 0 8px 28px;transition:background .15s,color .15s;display:inline-block;border:1px solid var(--teal);';

  const connBox = el('div', 'is05-box');
  const isMinimized = !!(S.rxIs05Minimized && S.rxIs05Minimized[r.id]);
  const cachedData  = S.rxIs05Cache[r.id] || null;

  function setConnBtnOpen()   { connBtn.textContent='▲ Minimize Connection'; connBtn.style.background='var(--teal)'; connBtn.style.color='#000'; }
  function setConnBtnClosed() { connBtn.textContent='⬇ IS-05 Connection';   connBtn.style.background='var(--teal-dim)'; connBtn.style.color='var(--teal)'; }

  function populateConnBox(data, usedUrl) {
    connBox.innerHTML = '';
    const urlEl = txt('div', '', usedUrl || '');
    urlEl.style.cssText = 'font-family:var(--mono);font-size:9px;color:var(--text2);padding-top:4px;padding-bottom:8px;word-break:break-all;';
    connBox.appendChild(urlEl);
    const idEl = txt('div', '', 'Receiver ID: ' + r.id);
    idEl.style.cssText = 'font-family:var(--mono);font-size:9px;color:var(--text2);padding-top:0;padding-bottom:8px;word-break:break-all;';
    connBox.appendChild(idEl);
    const rows = [];
    if (data.master_enable !== undefined) rows.push(['Master enable', data.master_enable ? '✔ Enabled' : '✘ Disabled']);
    if (data.sender_id) rows.push(['Sender ID', data.sender_id]);
    if (data.activation) {
      rows.push(['Activation mode', data.activation.mode||'—']);
      rows.push(['Activation time', data.activation.activation_time||'—']);
    }
    if (data.transport_params && data.transport_params.length) {
      data.transport_params.forEach((p, i) => {
        const leg = data.transport_params.length > 1 ? ' (leg '+(i+1)+')' : '';
        if (p.multicast_ip)    rows.push(['Multicast IP'+leg, p.multicast_ip]);
        if (p.source_ip)       rows.push(['Source IP'+leg, p.source_ip]);
        if (p.destination_port)rows.push(['Port'+leg, String(p.destination_port)]);
        if (p.interface_ip)    rows.push(['Interface IP'+leg, p.interface_ip]);
        if (p.rtp_enabled !== undefined) rows.push(['RTP enabled'+leg, p.rtp_enabled ? '✔' : '✘']);
      });
    }
    connBox.appendChild(kvTable(rows));
    if (data.transport_file && data.transport_file.data) {
      const sdp = data.transport_file.data;
      const fmtpMatch = sdp.match(/a=fmtp:\d+\s+(.+)/);
      if (fmtpMatch) {
        const params = {};
        fmtpMatch[1].split(';').forEach(p => { const [k,v]=p.trim().split('='); if(k&&v) params[k.trim()]=v.trim(); });
        const fmtpRows = [];
        if (params.width&&params.height) fmtpRows.push(['Resolution',params.width+'×'+params.height]);
        if (params.exactframerate) fmtpRows.push(['Frame rate',params.exactframerate]);
        if (params.depth)          fmtpRows.push(['Bit depth',params.depth+' bit']);
        if (params.TCS)            fmtpRows.push(['Transfer',params.TCS]);
        if (params.colorimetry)    fmtpRows.push(['Colorimetry',params.colorimetry]);
        if (params.sampling)       fmtpRows.push(['Sampling',params.sampling]);
        if (params.PM)             fmtpRows.push(['Packing',params.PM]);
        if (params.TP)             fmtpRows.push(['Timing',params.TP]);
        if (params.RANGE)          fmtpRows.push(['Range',params.RANGE]);
        if (fmtpRows.length) connBox.appendChild(kvTable(fmtpRows));
      }
      const sdpLabel = txt('div','','SDP');
      sdpLabel.style.cssText = 'font-size:9px;color:var(--text2);font-family:var(--mono);margin-top:8px;margin-bottom:4px;letter-spacing:.05em;';
      connBox.appendChild(sdpLabel);
      const sdpPre = document.createElement('pre');
      sdpPre.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:10px;font-size:10px;color:var(--green);overflow-x:auto;white-space:pre;line-height:1.5;margin:0 16px 8px 28px;';
      sdpPre.textContent = sdp;
      connBox.appendChild(sdpPre);
    }
  }

  // Restore from cache immediately — no flicker, no re-fetch
  if (cachedData) {
    populateConnBox(cachedData, cachedData._usedUrl || '');
    connBox.style.display = isMinimized ? 'none' : 'block';
    if (isMinimized) setConnBtnClosed(); else setConnBtnOpen();
  } else {
    // First time — show skeleton and fetch
    connBox.style.display = 'block';
    setConnBtnOpen();
    const connSkeleton = el('div', 'conn-skeleton');
    connSkeleton.innerHTML = '<div class="skeleton-line sk-w80"></div><div class="skeleton-line sk-w60"></div><div class="skeleton-line sk-w90"></div><div class="skeleton-line sk-w50"></div>';
    connBox.appendChild(connSkeleton);
    (async () => {
      const urlObj = new URL(S.apiBase);
      const origin = urlObj.protocol + '//' + urlObj.host;
      const urls = [
        origin+'/x-nmos/connection/v1.0/single/receivers/'+r.id+'/active',
        origin+'/x-nmos/connection/v1.1/single/receivers/'+r.id+'/active',
        origin+'/x-nmos/connection/v1.2/single/receivers/'+r.id+'/active',
      ];
      try {
        const verRes = await fetch(origin+'/x-nmos/connection/');
        if (verRes.ok) {
          const vers = await verRes.json();
          const sorted = vers.map(v=>v.replace(/\/$/,'')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).reverse();
          if (sorted.length) urls.unshift(origin+'/x-nmos/connection/'+sorted[0]+'/single/receivers/'+r.id+'/active');
        }
      } catch(e) {}
      let data=null, lastErr='', usedUrl='';
      for (const url of urls) {
        try { const res=await fetch(url); if(res.ok){data=await res.json();usedUrl=url;break;} lastErr='HTTP '+res.status+' — '+url; }
        catch(e) { lastErr=e.message+' — '+url; }
      }
      if (data) { data._usedUrl=usedUrl; S.rxIs05Cache[r.id]=data; populateConnBox(data,usedUrl); }
      else {
        connBox.innerHTML='';
        const errEl=txt('div','','⚠ '+lastErr);
        errEl.style.cssText='color:var(--amber);font-size:10px;padding:6px 16px 6px 28px;font-family:var(--mono);';
        connBox.appendChild(errEl);
      }
      connBox.style.display = (S.rxIs05Minimized&&S.rxIs05Minimized[r.id]) ? 'none' : 'block';
    })();
  }

  connBtn.addEventListener('click', () => {
    if (!S.rxIs05Minimized) S.rxIs05Minimized = {};
    if (connBox.style.display !== 'none') {
      connBox.style.display = 'none';
      S.rxIs05Minimized[r.id] = true;
      setConnBtnClosed();
    } else {
      connBox.style.display = 'block';
      delete S.rxIs05Minimized[r.id];
      setConnBtnOpen();
    }
  });

  connWrap.appendChild(connBtn);
  connWrap.appendChild(connBox);
  const nodeEl = node
    ? (S.jsonKeys
        ? node.id
        : (() => { const v = txt('span', 'clickable', node.label||node.hostname||r.node_id||'—'); v.dataset.nav = 'node:' + node.id; v.style.color = 'var(--text1)'; return v; })())
    : (r.node_id||'—');
  const devEl = dev
    ? (S.jsonKeys
        ? dev.id
        : (() => { const v = txt('span', 'clickable', dev.label||r.device_id); v.dataset.nav = 'device:' + dev.id; v.style.color = 'var(--text1)'; return v; })())
    : (r.device_id||'—');
  // Build rows in JSON object order — same positions in both modes
  const FRIENDLY_LABELS_R = {
    id: 'ID', label: 'Label', description: 'Description', device_id: 'Device',
    format: 'Format', transport: 'Transport', interface_bindings: 'Interfaces',
    caps: 'Caps', tags: 'Tags', subscription: 'Subscription', version: 'Version',
  };
  const rRows = [];
  // Friendly view: fixed logical order. JSON-keys view: mirror the raw JSON key order.
  const R_ORDER = ['id', 'label', 'description', 'device_id', 'flow_id', 'format', 'transport',
                   'interface_bindings', 'subscription', 'tags', 'version', 'manifest_href', 'caps'];
  const rKeys = S.jsonKeys
    ? Object.keys(r)
    : [...R_ORDER.filter(k => k in r), ...Object.keys(r).filter(k => !R_ORDER.includes(k))];
  rKeys.forEach(k => {
    if (S.jsonKeys) {
      const v = r[k];
      if (k === 'device_id' && S.lookup) {
        rRows.push([k, resolveUuid(v, 'device')]);
      } else if (k === 'subscription' && S.lookup && v && v.sender_id) {
        rRows.push([k, resolveUuid(v.sender_id, 'sender')]);
      } else if (k === 'version') {
        rRows.push([k, mkVersionEl(v)]);
      } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') rRows.push([k, String(v)]);
      else if (v === null) rRows.push([k, 'null']);
      else rRows.push([k, JSON.stringify(v)]);
    } else {
      const key = FRIENDLY_LABELS_R[k] || k;
      if (k === 'device_id') {
        rRows.push([key, resolveUuid(r.device_id, 'device')]);
      } else if (k === 'interface_bindings') {
        rRows.push([key, (r.interface_bindings||[]).join(', ')||'—']);
      } else if (k === 'caps') {
        rRows.push([key, r.caps&&r.caps.media_types ? r.caps.media_types.join(', ') : '—']);
      } else if (k === 'tags') {
        const gh = decodeGrouphint(r.tags) || { label: 'Tags', value: '—' };
        const lbl = gh.label || 'Tags';
        const tagsKey = lbl.startsWith('Grouphint') ? 'Tags (' + lbl.replace('Grouphint (','').replace(')','') + ')' : 'Tags';
        rRows.push([tagsKey, gh.value !== '—' ? gh.value : '—']);
      } else if (k === 'subscription') {
        const sub = r.subscription || {};
        const is05SenderId = (S.rxIs05Cache[r.id] && S.rxIs05Cache[r.id].sender_id) || null;
        const effectiveSenderId = sub.sender_id || is05SenderId;
        if (S.lookup && effectiveSenderId) {
          const wrap = document.createElement('span');
          wrap.appendChild(document.createTextNode((sub.active ? 'Active' : 'Inactive') + ' · sender '));
          wrap.appendChild(resolveUuid(effectiveSenderId, 'sender'));
          if (is05SenderId && !sub.sender_id) {
            const hint = txt('span', '', ' (from IS-05)');
            hint.style.cssText = 'font-size:9px;color:var(--text2);font-family:var(--mono);';
            wrap.appendChild(hint);
          }
          rRows.push([key, wrap]);
        } else {
          rRows.push([key, (sub.active ? 'Active' : 'Inactive') + (effectiveSenderId ? ' · sender ' + effectiveSenderId : ' · no sender')]);
        }
      } else if (k === 'version') {
        rRows.push([key, mkVersionEl(r.version)]);
      } else {
        rRows.push([key, r[k]||'—']);
      }
    }
  });
  db.appendChild(sectionWithToggle('Receiver info', null, [mkJsonToggle(), mkLookupToggle()], kvTable(rRows)));
  db.appendChild(section('IS-05 Connection', null, connWrap));

  // If routed, show sender details inline
  if (tx) {
    const mfEl = tx.manifest_href ? (() => { const a = document.createElement('a'); a.href = tx.manifest_href; a.target = '_blank'; a.textContent = tx.manifest_href; return a; })() : '—';
    const txIdEl = (() => { const v = txt('span', 'clickable', txId); v.dataset.nav = 'sender:' + txId; v.style.color = 'var(--text1)'; return v; })();
    db.appendChild(section('Routed sender', null, kvTable([
      ['Sender ID', txIdEl], ['Label', tx.label||'—'],
      ['Transport', tx.transport||'—'],
      ['Interfaces', (tx.interface_bindings||[]).join(', ')||'—'],
      ['Manifest', mfEl],
    ])));
  }

  detailPanel.appendChild(db);
}


// ── UUID detection and clipboard copy ──
function isUuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showCopyToast('Copied!');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showCopyToast('Copied!');
  });
}

function showCopyToast(msg) {
  let toast = document.getElementById('copy-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'copy-toast';
    toast.className = 'copy-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 1500);
}

// ── Helpers ──
function shortId(id) { return id ? id.slice(0, 8) + '…' : '—'; }

// Build the multicast display for a sender or receiver row.
// ST 2110-7: two legs (primary=red, secondary=blue) → show both with colored leg dots.
// Single path: one multicast IP, neutral leg dot.
// Append the multicast display to a leaf row and copy its tooltip onto the row,
// so the full IPs remain discoverable via hover even when the column is hidden
// (narrow panel) or clipped.
function appendMcast(leaf, id, kind, active) {
  const m = mkMcastDisplay(id, kind, active);
  if (!m) return;
  if (m.title) {
    leaf.title = leaf.title ? (leaf.title + '  •  ' + m.title) : m.title;
  }
  leaf.appendChild(m);
}

function mkMcastDisplay(id, kind, active) {
  const is05 = (kind === 'sender' ? S.sndIs05Cache : S.rxIs05Cache)[id];
  const emptyPlaceholder = () => { const e = el('span', 'l-mcast l-mcast-empty'); return e; };
  if (!is05 || !is05.transport_params) return emptyPlaceholder();
  const legs = is05.transport_params
    .map(p => p && (kind === 'sender' ? (p.destination_ip || p.multicast_ip) : p.multicast_ip))
    .filter(Boolean);
  if (!legs.length) return emptyPlaceholder();

  const wrap = el('span', 'l-mcast');
  if (active === false) wrap.classList.add('l-mcast-idle');
  if (legs.length >= 2) {
    // ST 2110-7 redundant: red (primary) + blue (secondary), each in its own fixed slot
    wrap.classList.add('mcast-2022-7');
    wrap.title = 'ST 2110-7 redundant — primary ' + legs[0] + ' / secondary ' + legs[1];
    const s1 = el('span', 'slot');
    s1.appendChild(el('span', 'leg-dot leg-red'));
    s1.appendChild(txt('span', 'l-mcast-ip l-mcast-ip-pri', legs[0]));
    wrap.appendChild(s1);
    const s2 = el('span', 'slot');
    s2.appendChild(el('span', 'leg-dot leg-blue'));
    s2.appendChild(txt('span', 'l-mcast-ip l-mcast-ip-sec', legs[1]));
    wrap.appendChild(s2);
  } else {
    // Single path — sits in the primary (left) slot
    wrap.title = 'Single path — ' + legs[0];
    const s1 = el('span', 'slot');
    s1.appendChild(el('span', 'leg-dot leg-single'));
    s1.appendChild(txt('span', 'l-mcast-ip', legs[0]));
    wrap.appendChild(s1);
  }
  return wrap;
}

function formatType(urn) {
  if (!urn) return 'data';
  if (urn.includes('video')) return 'video';
  if (urn.includes('audio')) return 'audio';
  if (urn.includes('mux'))   return 'mux';
  return 'data';
}

// Determine format for a sender from flow OR caps fallback (used by detail panel only)
function senderFormat(s, flows) {
  const flow = flows && flows.find(f => f.id === s.flow_id);
  if (flow && flow.format) return formatType(flow.format);
  if (s.caps && s.caps.media_types && s.caps.media_types.length) {
    const mt = s.caps.media_types[0];
    if (mt.includes('smpte291')) return 'data';
    return formatType(mt);
  }
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
    const chevs = isSender ? ['›','›','›'] : ['‹','‹','‹'];
    chevs.forEach(ch => {
      const s = document.createElement('span');
      s.textContent = ch;
      s.style.color = c.fg;
      s.style.opacity = '0.25';
      el.appendChild(s);
    });
  }
  return el;
}


// ── Keyboard navigation ──
document.addEventListener('keydown', (e) => {
  // Only handle when not typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const rows = Array.from(treeBody.querySelectorAll('[data-id]'));
  if (!rows.length) return;

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const currentIdx = rows.findIndex(r => r.classList.contains('sel-leaf') || r.classList.contains('sel-node') || r.classList.contains('sel-device') || r.dataset.id === S.sel.id);
    let nextIdx;
    if (e.key === 'ArrowDown') {
      nextIdx = currentIdx < rows.length - 1 ? currentIdx + 1 : 0;
    } else {
      nextIdx = currentIdx > 0 ? currentIdx - 1 : rows.length - 1;
    }
    const nextRow = rows[nextIdx];
    if (nextRow) {
      nextRow.click();
      nextRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } else if (e.key === 'Enter') {
    // Toggle open/close if it's a node or device
    const sel = S.sel;
    if (sel.type === 'node' || sel.type === 'device' || sel.type === 'folder') {
      if (S.open.has(sel.id)) S.open.delete(sel.id);
      else S.open.add(sel.id);
      renderTree();
    }
  } else if (e.key === 'Escape') {
    S.sel = { type: null, id: null };
    renderTree();
    detailPanel.innerHTML = '';
  }
});
