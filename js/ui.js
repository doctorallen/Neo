'use strict';
// ---------------------------------------------------------------------------
// The interface, all DOM: the top bar, the control deck (minimap, the
// terminal feed, the joystick and the buttons), hints, toasts, and every
// screen and card. A screen or card that should stop the world sets
// Game.modal; opening one drops the thumb that's down (Input.block) so a
// dodge can't tap a button by accident.
// ---------------------------------------------------------------------------

const HINTS = {
  move: { touch: '> drag in the deck to move', keys: '> WASD or arrows to move' },
  aim: { touch: () => `> hold the ${Save.settings.leftHanded ? 'left' : 'right'} side to hack`, keys: '> arrows or the mouse to hack' },
  door: { touch: '> drag in the deck: go to the door', keys: '> WASD: go to the door', id: 'move' },
  'phase-hurt': { touch: '> flick, or PHASE, to dodge', keys: '> SPACE to phase through attacks', btn: 'btn-phase', id: 'phase' },
  focus: { touch: '> FOCUS is ready: tap it', keys: '> SHIFT for bullet time', btn: 'btn-focus' },
  decrypt: { touch: '> stand in the ring to decrypt', keys: '> stand in the ring to decrypt' },
  loot: { touch: '> walk over loot to inspect it', keys: '> walk over loot to inspect it' },
  phone: { touch: '> answer the phone', keys: '> answer the phone' },
};

const UI = {
  screen: null, stack: [], hintId: null, hintT: 0, feedLines: [],
  hudT: 0,

  init() {
    $('build').textContent = typeof BUILD_INFO !== 'undefined' ? BUILD_INFO : '';
    $('btn-pause').addEventListener('click', () => { Sound.play('ui_tap'); this.openPause(); });
    $('btn-act').addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); if (Input.blocked()) return; Sound.play('ui_tap'); this.openUpgrades(); });
    for (const el of document.querySelectorAll('[data-back]')) el.addEventListener('click', () => { if (this.guarded(el)) return; Sound.play('ui_back'); this.back(); });
    $('crt-skip').addEventListener('click', (ev) => { ev.stopPropagation(); hubTap(); });
    $('screen-crt').addEventListener('pointerdown', () => hubTap());
    $('stage').addEventListener('pointerdown', () => { if (Game.scene === 'hub' && Game.hub && Game.hub.i < Game.hub.script.length) hubTap(); });
    this.applySettings();
  },

  // ---- screens ----
  show(id, { modal = true, keep = false } = {}) {
    if (this.screen) $(this.screen).hidden = true;
    if (this.screen && keep) this.stack.push(this.screen);
    if (id) $('screen-crt').hidden = true;
    this.screen = id;
    if (id) $(id).hidden = false;
    Game.modal = id && modal ? id : null;
    Input.block(400);
    this.guardButtons(id);
  },
  hide() {
    if (this.screen) $(this.screen).hidden = true;
    this.screen = null;
    this.stack = [];
    Game.modal = null;
    Input.block(150);
  },
  back() {
    if (this.screen) $(this.screen).hidden = true;
    const prev = this.stack.pop();
    this.screen = prev || null;
    if (prev) { $(prev).hidden = false; Game.modal = prev; if (prev === 'screen-title') Game.modal = null; this.refresh(prev); }
    else Game.modal = null;
    Input.block(150);
  },
  refresh(id) {
    if (id === 'screen-title') this.buildTitle();
    if (id === 'screen-pause') this.buildPause();
  },
  // buttons on a fresh screen ignore taps for a moment
  guardButtons(id) {
    if (!id) return;
    const el = $(id);
    el.dataset.guard = String(performance.now() + 400);
  },
  guarded(el) {
    const s = el.closest('.screen');
    return s && Number(s.dataset.guard || 0) > performance.now();
  },
  button(label, onClick, cls = 'btn') {
    const b = document.createElement('button');
    b.className = cls;
    b.innerHTML = label;
    b.addEventListener('click', (ev) => { if (this.guarded(b)) return; ev.stopPropagation(); Sound.play('ui_tap'); onClick(ev); });
    return b;
  },
  onEscape() {
    if (this.screen === 'screen-title') return;
    if (this.screen === 'screen-pause') { this.resume(); return; }
    if (['screen-settings', 'screen-loadout', 'screen-records', 'screen-upgrades'].includes(this.screen)) { this.back(); return; }
    if (!this.screen && (Game.scene === 'run' || Game.scene === 'hub')) this.openPause();
  },
  onEnter() {
    const s = this.screen && $(this.screen);
    const b = s && s.querySelector('.btn.primary:not([hidden]), .btn:not([hidden])');
    if (b && !this.guarded(b)) b.click();
  },

  // ---- title ----
  openTitle() {
    Game.scene = 'title';
    Game.pendingDaily = false;
    Game.run = null; Game.room = null; Game.hub = null;
    this.show('screen-title', { modal: false });
    this.buildTitle();
    Sound.music('title');
    startRain();
  },
  buildTitle() {
    const m = $('title-menu');
    m.innerHTML = '';
    const cp = Save.data.checkpoint;
    if (cp) m.appendChild(this.button(`CONTINUE<small>sector ${cp.floor}/5${cp.daily ? ' · daily trace' : ''}</small>`, () => { this.firstTap(); this.hide(); stopRain(); continueRun(); }, 'btn primary'));
    m.appendChild(this.button('<span class="blink">&gt; wake up</span>', () => {
      this.firstTap();
      const go = () => { Save.data.checkpoint = null; Save.write(); this.hide(); stopRain(); enterHub({ won: false }); };
      if (cp) this.confirm('ABANDON SAVED RUN?', 'The run in progress will be lost.', go); else go();
    }, cp ? 'btn' : 'btn primary'));
    m.appendChild(this.button(`DAILY TRACE<small>${this.dailyLine()}</small>`, () => {
      this.firstTap();
      const go = () => { Save.data.checkpoint = null; Save.write(); Game.pendingDaily = true; this.hide(); stopRain(); enterHub({ won: false }); };
      if (cp) this.confirm('ABANDON SAVED RUN?', 'The run in progress will be lost.', go); else go();
    }));
    m.appendChild(this.button('RECORDS', () => this.openRecords(true)));
    m.appendChild(this.button('SETTINGS', () => this.openSettings(true)));
  },
  dailyLine() {
    const d = Save.data.records.daily;
    if (d.key === todayKey() && d.best) return `today's best ${fmtTime(d.best)}`;
    if (d.key === todayKey() && d.deepest) return `today: sector ${d.deepest}`;
    return 'one seed for everyone today';
  },
  // Android: a tap may go full screen (iPhone has no such thing)
  firstTap() {
    Sound.unlock();
    try {
      const el = document.documentElement;
      if (/Android/i.test(navigator.userAgent) && el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    } catch (e) { /* no full screen here */ }
  },

  // ---- confirm ----
  confirm(title, text, yes) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    const prev = this.screen;
    this.show('screen-confirm', { keep: true });
    $('confirm-yes').onclick = () => { if (this.guarded($('confirm-yes'))) return; Sound.play('ui_tap'); $('screen-confirm').hidden = true; this.screen = this.stack.pop() || null; yes(); };
    $('confirm-no').onclick = () => { if (this.guarded($('confirm-no'))) return; Sound.play('ui_back'); this.back(); };
    return prev;
  },

  // ---- pause ----
  openPause() {
    if (Game.scene !== 'run' && Game.scene !== 'hub') return;
    if (this.screen && this.screen !== 'screen-pause') return;
    if (Game.flow && Game.flow.kind !== 'phone') return;
    this.show('screen-pause');
    this.buildPause();
  },
  buildPause() {
    const m = $('pause-menu');
    m.innerHTML = '';
    m.appendChild(this.button('RESUME', () => this.resume(), 'btn primary'));
    if (Game.scene === 'run') {
      m.appendChild(this.button('LOADOUT', () => this.openLoadout()));
      m.appendChild(this.button('SETTINGS', () => this.openSettings(true)));
      m.appendChild(this.button('ABANDON RUN', () => this.confirm('ABANDON RUN?', 'It counts as a loss. Data earned so far is kept.', () => { this.hide(); abandonRun(); }), 'btn danger'));
    } else {
      m.appendChild(this.button('SETTINGS', () => this.openSettings(true)));
      m.appendChild(this.button('RECORDS', () => this.openRecords(true)));
      m.appendChild(this.button('TITLE SCREEN', () => { this.hide(); this.openTitle(); }));
    }
  },
  resume() { this.hide(); },

  // ---- loadout ----
  openLoadout() {
    const run = Game.run;
    const items = $('loadout-items');
    items.innerHTML = '';
    for (const slot of SLOTS) {
      const it = run.gear[slot];
      const d = document.createElement('div');
      d.className = 'card';
      d.style.color = it ? T.rarity.colors[it.rarity] : '#2f5a3a';
      d.innerHTML = it ? this.itemHtml(it) : `<div class="slot">${SLOT_NAMES[slot]}</div><div class="line" style="color:#2f5a3a">— empty —</div>`;
      items.appendChild(d);
    }
    const chips = $('loadout-patches');
    chips.innerHTML = run.patches.length ? '' : '<span style="color:#2f5a3a;font-size:18px">none yet</span>';
    const counts = {};
    for (const p of run.patches) counts[p] = (counts[p] || 0) + 1;
    for (const id of Object.keys(counts)) { const c = document.createElement('span'); c.className = 'chip'; c.textContent = PATCH[id].name + (counts[id] > 1 ? ` ×${counts[id]}` : ''); chips.appendChild(c); }
    const s = run.stats;
    const rows = [
      ['Integrity', `${Math.ceil(run.hp)} / ${s.maxHp}`], ['Exploit', T.exploits[s.weapon.base].name], ['Damage per shot', Math.round(s.weapon.dmg)],
      ['Shots per second', s.weapon.rate.toFixed(1)], ['Projectiles', '+' + s.proj], ['Pierce / chain', `${s.weapon.pierce} / ${s.weapon.chain}`],
      ['Crit chance', pct(s.crit)], ['Crit damage', pct(T.critMult + s.critdmg)], ['Armour', pct(s.armor)], ['Move speed', '+' + pct(s.speed)],
      ['Leech', pct(s.leech)], ['Corrupt', pct(s.corrupt)], ['Slow chance', pct(s.throttle)], ['Phase cooldown', s.phaseCd.toFixed(2) + 's'],
      ['Focus gain', '+' + pct(s.focus)], ['Thorns', s.thorns], ['Data gain', '+' + pct(s.data)], ['Item rarity', '+' + pct(s.luck)],
    ];
    $('loadout-stats').innerHTML = rows.map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`).join('');
    this.show('screen-loadout', { keep: true });
  },

  itemHtml(it, { compareTo = null } = {}) {
    const col = T.rarity.colors[it.rarity];
    const lines = [];
    lines.push(`<div class="rar" style="color:${col}">${T.rarity.names[it.rarity].toUpperCase()}</div>`);
    lines.push(`<div class="name" style="color:${col}">${escapeHtml(it.name)}</div>`);
    lines.push(`<div class="slot">${SLOT_NAMES[it.slot]}${it.slot === 'exploit' ? ' · ' + T.exploits[it.base].name : ''} · level ${it.ilvl}</div>`);
    if (it.slot === 'exploit') { const E = T.exploits[it.base]; lines.push(`<div class="line implicit">base ${Math.round(exploitDamage(it.base, it.ilvl))} damage × ${E.rate.toFixed(1)}/s · ${exploitPatternText(it.base)}</div>`); }
    for (const a of it.implicit) lines.push(`<div class="line implicit">${fmtAffix(a.id, a.v)}</div>`);
    for (const a of it.affixes) lines.push(`<div class="line">${fmtAffix(a.id, a.v)}</div>`);
    if (it.unique) lines.push(`<div class="power">${escapeHtml(ZD[it.unique].power)}</div>`);
    return lines.join('');
  },

  // ---- the compare card ----
  openCompare(item, cb) {
    const run = Game.run, cur = run.gear[item.slot];
    const v = compareVerdict(run.gear, run.patches, item, run.floorN);
    const card = $('compare-card');
    card.style.color = T.rarity.colors[item.rarity];
    const diffs = statDiffs(run.gear, run.patches, item, run.floorN);
    card.innerHTML =
      `<div class="verdict ${v.delta >= 0 ? 'up' : 'down'}">${v.delta >= 0 ? '▲' : '▼'} ${v.text}</div>` +
      this.itemHtml(item) +
      `<div class="diff">${diffs.map((d) => `<div class="line ${d.up ? 'up' : 'down'}">${d.up ? '▲' : '▼'} ${d.text}</div>`).join('') || '<div class="line" style="color:#4f8a5e">no change to your stats</div>'}</div>` +
      (cur ? `<div class="equipped">equipped: <span style="color:${T.rarity.colors[cur.rarity]}">${escapeHtml(cur.name)}</span></div>` : '') +
      `<div class="row"></div>`;
    const row = card.querySelector('.row');
    const done = (c) => { this.hide(); cb(c); };
    row.appendChild(this.button('EQUIP', () => done('equip'), 'btn primary'));
    row.appendChild(this.button(`SCRAP <small>+${Math.round(T.rarity.scrap[item.rarity] * (1 + run.stats.data))} data</small>`, () => done('scrap')));
    this.show('screen-compare');
  },

  // ---- the cache: one of these ----
  openCache(items, cb) {
    const run = Game.run, box = $('cache-options');
    box.innerHTML = '';
    for (const it of items) {
      const v = compareVerdict(run.gear, run.patches, it, run.floorN);
      const cur = run.gear[it.slot];
      const b = this.button(
        `<span class="name">${escapeHtml(it.name)}</span><span class="sub">${T.rarity.names[it.rarity]} ${SLOT_NAMES[it.slot]}${it.slot === 'exploit' ? ' · ' + T.exploits[it.base].name : ''} · level ${it.ilvl}</span>` +
        it.implicit.concat(it.affixes).map((a) => `<span class="line">${fmtAffix(a.id, a.v)}</span>`).join('') +
        (it.unique ? `<span class="line" style="color:var(--gold)">${escapeHtml(ZD[it.unique].power)}</span>` : '') +
        `<span class="verdict ${cur ? (v.delta >= 0 ? 'up' : 'down') : 'up'}">${cur ? (v.delta >= 0 ? '▲ ' : '▼ ') + v.text : '▲ fills an empty slot'}</span>`,
        () => { this.hide(); cb(it); }, 'option');
      b.style.color = T.rarity.colors[it.rarity];
      box.appendChild(b);
    }
    const total = items.reduce((a, it) => a + T.rarity.scrap[it.rarity], 0);
    box.appendChild(this.button(`SCRAP ALL <small>+${Math.round(total * (1 + run.stats.data))} data</small>`, () => { this.hide(); cb(null); }));
    this.show('screen-cache');
  },

  // ---- patches ----
  openPatchPick(floorDone, cb) {
    const run = Game.run;
    let rerolled = false;
    const n = run.extraPick ? 4 : 3;
    run.extraPick = false;
    const build = () => {
      const offer = patchOffer(run.rng, run.patches, floorDone, n);
      $('patch-sub').textContent = `sector ${floorDone} cleared. choose one.`;
      const box = $('patch-options');
      box.innerHTML = '';
      for (const id of offer) {
        const p = PATCH[id];
        const have = run.patches.filter((x) => x === id).length;
        box.appendChild(this.button(`<span class="name">${p.name}${have ? ` <small>(have ${have})</small>` : ''}</span><span class="line">${p.desc}</span>${p.rare ? '<span class="sub">rare</span>' : ''}`, () => { this.hide(); cb(id); }, 'option patch' + (p.rare ? ' rare' : '')));
      }
      const extra = $('patch-extra');
      extra.innerHTML = '';
      if (Save.rank('reroll') && !rerolled) extra.appendChild(this.button('REROLL', () => { rerolled = true; build(); this.guardButtons('screen-patch'); }));
      if (!offer.length) extra.appendChild(this.button('CONTINUE', () => { this.hide(); cb(null); }, 'btn primary'));
    };
    build();
    this.show('screen-patch');
  },

  // ---- the Oracle ----
  openOracle(ev) {
    const card = $('oracle-card');
    card.style.color = '#3cff6e';
    card.innerHTML = `<div class="rar">THE ORACLE</div><div class="name">${escapeHtml(ev.title)}</div><div class="text">${escapeHtml(ev.text)}</div><div class="choices"></div>`;
    const box = card.querySelector('.choices');
    for (const c of ev.choices) {
      if (c.when && !c.when()) continue;
      box.appendChild(this.button(c.label, () => { this.hide(); c.act(); Sound.play('ui_buy'); }, 'btn primary'));
    }
    if (!ev.noLeave || !box.children.length) box.appendChild(this.button('Leave', () => this.hide()));
    this.show('screen-oracle');
  },

  // ---- the summary ----
  openSummary(run) {
    const won = run.victory;
    const h = $('sum-title');
    h.textContent = won ? 'ROOT ACCESS' : 'CONNECTION LOST';
    h.className = won ? 'won' : 'lost';
    const best = run.best;
    const rows = [
      ['sector', won ? 'core · cleared' : `${run.floorN} / 5 · ${T.floors[run.floorN - 1].sector}`],
      ['time', fmtTime(run.time)],
      ['processes killed', run.kills],
      ['data earned', Math.floor(run.data)],
      ['best find', best ? `<span style="color:${T.rarity.colors[best.rarity]}">${escapeHtml(best.name)}</span>` : '—'],
    ];
    if (!won) rows.push(['terminated by', escapeHtml(run.killedBy || 'unknown')]);
    if (run.depth > 1) rows.push(['depth', run.depth]);
    if (run.daily) rows.push(['daily trace', todayKey()]);
    const lines = $('sum-lines');
    lines.innerHTML = '';
    const unl = [...run.newUnlocks];
    if (run.unlockedZeroDay) unl.unshift(`Zero-Day decompiled: ${ZD[run.unlockedZeroDay].name}`);
    $('sum-unlocks').innerHTML = unl.map((u) => '◆ ' + escapeHtml(u)).join('<br>');
    $('sum-unlocks').hidden = true;
    // the lines arrive one by one; a tap shows them all
    let i = 0;
    const wake = $('sum-wake');
    wake.hidden = true;
    const step = () => {
      if (this.screen !== 'screen-summary') return;
      if (i < rows.length) { lines.insertAdjacentHTML('beforeend', `<span class="k">${rows[i][0]}</span><span class="v">${rows[i][1]}</span>`); i++; Sound.play('key'); this.sumTimer = setTimeout(step, 180); }
      else { wake.hidden = false; $('sum-unlocks').hidden = false; }
    };
    $('screen-summary').onpointerdown = () => { if (i < rows.length) { clearTimeout(this.sumTimer); while (i < rows.length) { lines.insertAdjacentHTML('beforeend', `<span class="k">${rows[i][0]}</span><span class="v">${rows[i][1]}</span>`); i++; } wake.hidden = false; $('sum-unlocks').hidden = false; this.guardButtons('screen-summary'); } };
    wake.onclick = () => { if (this.guarded(wake)) return; Sound.play('ui_tap'); this.hide(); enterHub({ won }); };
    this.show('screen-summary');
    setTimeout(step, 450);
  },

  // ---- the kernel (permanent upgrades) ----
  openUpgrades() {
    if (Game.scene !== 'hub') return;
    this.buildUpgrades();
    this.show('screen-upgrades', { keep: !!this.screen });
    Sound.play('boot');
  },
  buildUpgrades() {
    $('up-data').textContent = Math.floor(Save.meta.data);
    const list = $('up-list');
    list.innerHTML = '';
    for (const u of T.upgrades) {
      const rank = Save.rank(u.id), max = u.costs.length, cost = u.costs[rank];
      const d = document.createElement('div');
      d.className = 'up-item';
      d.innerHTML = `<div class="info"><div class="nm">${u.name}</div><div class="ds">${u.desc}</div><div class="pips">${'■'.repeat(rank)}${'□'.repeat(max - rank)}</div></div>`;
      const b = document.createElement('button');
      b.className = 'buy';
      b.textContent = rank >= max ? 'MAX' : `◆ ${cost}`;
      b.disabled = rank >= max || Save.meta.data < cost;
      b.addEventListener('click', () => {
        if (this.guarded(b) || rank >= max) return;
        if (Save.meta.data < cost) { Sound.play('ui_deny'); return; }
        Save.meta.data -= cost; Save.meta.upgrades[u.id] = rank + 1; Save.write();
        Sound.play('ui_buy'); this.buildUpgrades(); this.updateHud(true);
      });
      d.appendChild(b);
      list.appendChild(d);
    }
    // the depth
    const dep = $('up-depth');
    dep.innerHTML = '';
    if (Save.meta.maxDepth > 1) {
      dep.innerHTML = '<div class="lbl">DEPTH · deeper layers: tougher processes, better loot, more data</div>';
      for (let i = 1; i <= Save.meta.maxDepth; i++) {
        const b = document.createElement('button');
        b.textContent = i;
        if ((Save.meta.depth || 1) === i) b.className = 'on';
        b.addEventListener('click', () => { if (this.guarded(b)) return; Save.meta.depth = i; Save.write(); Sound.play('ui_tap'); this.buildUpgrades(); });
        dep.appendChild(b);
      }
    }
    // Zero-Days still to decompile
    const zl = $('up-zd');
    zl.innerHTML = '';
    const locked = ZERO_DAYS.filter((z) => !z.start && !Save.unlocked('zd_' + z.id));
    if (locked.length) {
      zl.insertAdjacentHTML('beforeend', '<h3>DECOMPILE ZERO-DAYS</h3>');
      for (const z of locked) {
        const d = document.createElement('div');
        d.className = 'up-item';
        d.innerHTML = `<div class="info"><div class="nm" style="color:var(--gold)">${escapeHtml(z.name)}</div><div class="ds">${SLOT_NAMES[z.slot]}: ${escapeHtml(z.power)}</div></div>`;
        const b = document.createElement('button');
        b.className = 'buy';
        b.textContent = `◆ ${z.cost}`;
        b.disabled = Save.meta.data < z.cost;
        b.addEventListener('click', () => {
          if (this.guarded(b)) return;
          if (Save.meta.data < z.cost) { Sound.play('ui_deny'); return; }
          Save.meta.data -= z.cost; Save.unlock('zd_' + z.id); Save.write();
          Sound.play('ui_buy'); this.buildUpgrades(); this.updateHud(true);
        });
        d.appendChild(b);
        zl.appendChild(d);
      }
    }
  },

  // ---- records ----
  openRecords(keep) {
    const r = Save.data.records;
    const rows = [
      ['runs', r.runs], ['wins', r.wins], ['best time', r.bestTime ? fmtTime(r.bestTime) : '—'], ['deepest sector', r.deepest || '—'],
      ['processes killed', r.kills], ['zero-days found', `${Object.keys(Save.meta.zeroDays).length} / ${ZERO_DAYS.length}`],
      ['deepest depth won', r.bestDepthWin || '—'], ['data banked', Math.floor(Save.meta.data)],
      ['daily trace today', r.daily.key === todayKey() ? (r.daily.best ? fmtTime(r.daily.best) : `sector ${r.daily.deepest}`) : '—'],
    ];
    $('records-stats').innerHTML = rows.map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`).join('');
    $('records-codex').innerHTML = ZERO_DAYS.map((z) => Save.meta.zeroDays[z.id] ? `<div class="found">${escapeHtml(z.name)}</div>` : '<div>???</div>').join('');
    this.show('screen-records', { keep: !!keep && !!this.screen, modal: Game.scene !== 'title' });
  },

  // ---- settings ----
  openSettings(keep) {
    this.buildSettings();
    this.show('screen-settings', { keep: !!keep && !!this.screen, modal: Game.scene !== 'title' });
  },
  buildSettings() {
    const S = Save.settings, box = $('settings-list');
    box.innerHTML = '';
    const toggle = (label, key, after) => {
      const b = this.button(`<span>${label}</span><span class="val">${S[key] ? 'ON' : 'OFF'}</span>`, () => { S[key] = !S[key]; Save.write(); this.applySettings(); if (after) after(); this.buildSettings(); }, 'setting');
      box.appendChild(b);
    };
    const slider = (label, key) => {
      const d = document.createElement('label');
      d.className = 'setting';
      d.innerHTML = `<span>${label}</span><input type="range" min="0" max="100" step="5" value="${Math.round(S[key] * 100)}">`;
      const inp = d.querySelector('input');
      inp.addEventListener('input', () => { S[key] = Number(inp.value) / 100; this.applySettings(); });
      inp.addEventListener('change', () => { Save.write(); Sound.play('ui_tap'); });
      box.appendChild(d);
    };
    slider('Music', 'music');
    slider('Effects', 'sfx');
    if (navigator.vibrate) toggle('Haptics', 'haptics');
    toggle('Screen shake', 'shake');
    toggle('Reduced flashing', 'reducedFlash');
    toggle('CRT scanlines', 'scanlines');
    toggle('Damage numbers', 'damageNumbers');
    toggle('Flick to phase', 'flickPhase');
    toggle('Aim assist', 'aimAssist');
    toggle('Left-handed', 'leftHanded');
    toggle('Full intro every time', 'fullIntro');
    const names = ['OFF', 'COMMON', 'UNCOMMON'];
    box.appendChild(this.button(`<span>Auto-scrap</span><span class="val">${names[S.autoScrap]}</span>`, () => { S.autoScrap = (S.autoScrap + 1) % 3; Save.write(); this.buildSettings(); }, 'setting'));
    box.appendChild(this.button('<span>Show hints again</span><span class="val">↺</span>', () => { Save.meta.hints = {}; Save.write(); this.toast('HINTS RESET', 1); }, 'setting'));
    // reset: hold to confirm (not in the middle of a run)
    if (Game.scene === 'run') return;
    const hold = document.createElement('button');
    hold.className = 'setting hold';
    hold.innerHTML = '<div class="fill"></div><span>Hold to reset all progress</span>';
    let t0 = 0, raf = 0;
    const fill = hold.querySelector('.fill');
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / 1500);
      fill.style.width = k * 100 + '%';
      if (k >= 1) { Save.reset(); this.applySettings(); Sound.play('glitch'); hold.querySelector('span').textContent = 'PROGRESS ERASED'; fill.style.width = '0'; t0 = 0; return; }
      raf = requestAnimationFrame(tick);
    };
    hold.addEventListener('pointerdown', (ev) => { ev.preventDefault(); t0 = performance.now(); raf = requestAnimationFrame(tick); });
    const stop = () => { cancelAnimationFrame(raf); if (t0) fill.style.width = '0'; t0 = 0; };
    hold.addEventListener('pointerup', stop); hold.addEventListener('pointerleave', stop); hold.addEventListener('pointercancel', stop);
    box.appendChild(hold);
  },
  applySettings() {
    const S = Save.settings;
    Sound.setVolumes(S.music, S.sfx);
    $('app').classList.toggle('lefty', !!S.leftHanded);
    $('app').classList.toggle('no-scanlines', !S.scanlines);
  },

  // ---- run hooks ----
  onFloorStart(n, resumed) {
    $('app').classList.remove('hub-mode');
    $('btn-act').hidden = true;
    $('aim-ghost').hidden = true;
    this.feedLines = [];
    this.feed(`> sector ${n}: ${T.floors[n - 1].sector}${resumed ? ' (restored)' : ''}`);
    if (n === 5) this.feed('> core reached');
    this.banner(n === 5 ? 'CORE' : `SECTOR ${n}`);
    this.updateHud(true);
  },
  onRoomChange() { this.drawMinimap(); $('aim-ghost').hidden = true; },
  onHub(h) {
    $('app').classList.add('hub-mode');
    $('btn-act').hidden = true;
    $('aim-ghost').hidden = true;
    this.feedLines = [];
    $('feed').innerHTML = '';
    $('stick-ghost').hidden = Save.meta.tutorialDone;
    $('sector').textContent = '';
    if (Game.pendingDaily) this.feed('> daily trace armed');
    this.updateHud(true);
  },
  hubAction(kind) {
    $('btn-act').hidden = kind !== 'terminal';
    if (kind === 'terminal') this.feed(`> terminal: ${Math.floor(Save.meta.data)} data`);
  },

  // ---- the CRT ----
  crt(text, done) {
    const el = $('screen-crt');
    if (text === null) { el.hidden = true; return; }
    el.hidden = false;
    $('crt-line').textContent = text;
    $('crt-skip').hidden = !(Save.meta.introSeen || (Game.hub && Game.hub.realT > 3));
  },

  // ---- hints, the feed, banners, toasts ----
  hint(id) {
    const h = HINTS[id];
    if (!h) return;
    const key = h.id || id;
    if (Save.meta.hints[key]) return;
    if (this.hintId && this.hintId !== id) return;
    Save.meta.hints[key] = true;
    this.hintId = id; this.hintT = 6;
    const el = $('hint');
    const text = Input.usedTouch || matchMedia('(pointer: coarse)').matches ? h.touch : h.keys;
    el.textContent = typeof text === 'function' ? text() : text;
    el.hidden = false;
    if (h.btn) $(h.btn).classList.add('pulse');
  },
  hintDone(id) {
    const cur = this.hintId;
    if (!cur) return;
    const h = HINTS[cur];
    if (cur === id || (h && h.id === id)) this.clearHint();
  },
  clearHint() {
    const h = HINTS[this.hintId];
    if (h && h.btn) $(h.btn).classList.remove('pulse');
    $('hint').hidden = true;
    this.hintId = null;
  },
  feed(text) {
    this.feedLines.push(text);
    if (this.feedLines.length > 3) this.feedLines.shift();
    $('feed').innerHTML = this.feedLines.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
  },
  banner(text, cls = '') {
    const el = $('banner');
    el.hidden = true;
    void el.offsetWidth;
    el.className = 'banner ' + cls;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => { el.hidden = true; }, cls === 'boss' ? 2200 : 1400);
  },
  bossLine(text) { this.banner(`"${text}"`, 'boss'); this.feed(`> agent: ${text}`); },
  toast(text, rarity = 0) {
    this.feed('> ' + text.toLowerCase());
    if (rarity < 3) return;
    const box = $('toasts');
    const d = document.createElement('div');
    d.className = 'toast';
    d.style.color = T.rarity.colors[clamp(rarity, 0, 4)];
    d.textContent = text;
    box.appendChild(d);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => d.remove(), 2500);
  },

  showAim(s) {
    const base = $('aim-base');
    if (!s) { base.hidden = true; return; }
    base.hidden = false;
    $('aim-ghost').hidden = true;
    base.style.left = s.bx + 'px'; base.style.top = s.by + 'px';
    $('aim-knob').style.transform = `translate(${s.x - s.bx}px, ${s.y - s.by}px)`;
  },
  showStick(s) {
    const base = $('stick-base');
    if (!s) { base.hidden = true; return; }
    base.hidden = false;
    $('stick-ghost').hidden = true;
    base.style.left = s.bx + 'px'; base.style.top = s.by + 'px';
    const knob = $('stick-knob');
    knob.style.transform = `translate(${s.x - s.bx}px, ${s.y - s.by}px)`;
  },

  // ---- per frame ----
  frame(dt) {
    if (this.hintId) { this.hintT -= dt; if (this.hintT <= 0) this.clearHint(); }
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.1; this.updateHud(); }
  },
  updateHud(force) {
    const run = Game.run;
    $('data').textContent = Math.floor(Save.meta.data + (run ? Math.floor(run.data) - run.dataCommitted : 0));
    if (!run || Game.scene !== 'run') { $('timer').textContent = Game.scene === 'hub' ? '03:14' : ''; return; }
    const s = run.stats;
    const k = clamp(run.hp / s.maxHp, 0, 1);
    const fill = $('hp-fill');
    fill.style.width = k * 100 + '%';
    fill.classList.toggle('low', k < 0.3);
    $('hp-text').textContent = Math.max(0, Math.ceil(run.hp));
    $('sector').textContent = run.floorN === 5 ? 'CORE' : `SECTOR ${run.floorN}/5`;
    $('timer').textContent = fmtTime(run.time);
    const f = clamp(run.focus / T.focus.max, 0, 1);
    $('focus-ring').style.strokeDashoffset = String(283 * (1 - (Game.bt ? Game.bt.left / Game.bt.total : f)));
    $('btn-focus').classList.toggle('ready', f >= 1 && !Game.bt);
    const p = Game.player;
    const cd = p && s ? clamp(p.phaseCdT / s.phaseCd, 0, 1) : 0;
    $('phase-ring').style.strokeDashoffset = String(283 * cd);
    $('btn-phase').classList.toggle('cooling', cd > 0);
    if (force || Game.realT % 0.5 < 0.11) this.drawMinimap();
  },

  drawMinimap() {
    const c = $('minimap'), run = Game.run;
    const dpr = 2;
    if (c.width !== 72 * dpr) { c.width = 72 * dpr; c.height = 72 * dpr; }
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, 72, 72);
    if (!run || !run.floor) return;
    const rooms = run.floor.rooms;
    const known = new Set();
    for (const r of rooms) if (r.visited) { known.add(r); for (const d of Object.values(r.doors)) if (!d.hidden) known.add(d.to); }
    let minX = 9, minY = 9, maxX = -1, maxY = -1;
    for (const r of known) { minX = Math.min(minX, r.gx); minY = Math.min(minY, r.gy); maxX = Math.max(maxX, r.gx); maxY = Math.max(maxY, r.gy); }
    const cell = 10, gap = 2;
    const ox = Math.round(36 - ((maxX - minX + 1) * cell) / 2), oy = Math.round(36 - ((maxY - minY + 1) * cell) / 2);
    const pos = (r) => [ox + (r.gx - minX) * cell, oy + (r.gy - minY) * cell];
    // corridors
    x.fillStyle = '#1d4a2a';
    for (const r of known) for (const [dir, d] of Object.entries(r.doors)) {
      if (d.hidden || !known.has(d.to)) continue;
      const [px, py] = pos(r), [dx, dy] = DIRS[dir];
      x.fillRect(px + cell / 2 - 1 + dx * 4, py + cell / 2 - 1 + dy * 4, 2, 2);
    }
    for (const r of known) {
      const [px, py] = pos(r);
      const here = r === Game.room;
      x.fillStyle = here ? (Math.floor(Game.realT * 3) % 2 ? '#eaffef' : '#3cff6e') : r.visited ? (r.cleared ? '#2f8a4a' : '#8a6a20') : '#0f3a1c';
      x.fillRect(px + gap / 2, py + gap / 2, cell - gap, cell - gap);
      const icon = { cache: '#ffb43a', oracle: '#4aa8ff', exit: '#eaffef', boss: '#ff4060', rabbit: '#ffffff' }[r.kind];
      if (icon && !here) { x.fillStyle = icon; x.fillRect(px + cell / 2 - 1, py + cell / 2 - 1, 2, 2); }
    }
  },
};

function exploitPatternText(base) {
  const E = T.exploits[base];
  return { single: 'single shot', spread: `${E.shots}-way spread`, pierce: `pierces ${E.pierce}`, chain: `chains to ${E.chain}`, homing: 'homing', lob: 'lobbed blast' }[E.pattern];
}

// The stats that would change if `item` were equipped, as ▲/▼ lines.
function statDiffs(gear, patches, item, floorN) {
  const a = computeStats(gear, patches, floorN), b = computeStats({ ...gear, [item.slot]: item }, patches, floorN);
  const out = [];
  const num = (label, x, y, fmt, invert = false) => {
    if (Math.abs(x - y) < 1e-6) return;
    const up = invert ? y < x : y > x;
    out.push({ up, text: `${label} ${fmt(x)} → ${fmt(y)}` });
  };
  const p = (v) => Math.round(v * 100) + '%';
  const i = (v) => String(Math.round(v));
  num('damage per shot', a.weapon.dmg, b.weapon.dmg, i);
  num('shots/s', a.weapon.rate, b.weapon.rate, (v) => v.toFixed(1));
  num('projectiles', a.proj, b.proj, (v) => '+' + v);
  num('pierce', a.weapon.pierce, b.weapon.pierce, i);
  num('chain', a.weapon.chain, b.weapon.chain, i);
  num('max integrity', a.maxHp, b.maxHp, i);
  num('armour', a.armor, b.armor, p);
  num('crit chance', a.crit, b.crit, p);
  num('crit damage', a.critdmg, b.critdmg, (v) => '+' + p(v));
  num('move speed', a.speed, b.speed, (v) => '+' + p(v));
  num('leech', a.leech, b.leech, p);
  num('corrupt', a.corrupt, b.corrupt, p);
  num('slow chance', a.throttle, b.throttle, p);
  num('phase cooldown', a.phaseCd, b.phaseCd, (v) => v.toFixed(2) + 's', true);
  num('focus gain', a.focus, b.focus, (v) => '+' + p(v));
  num('pickup radius', a.pickup, b.pickup, (v) => '+' + p(v));
  num('thorns', a.thorns, b.thorns, i);
  num('data gain', a.data, b.data, (v) => '+' + p(v));
  num('item rarity', a.luck, b.luck, (v) => '+' + p(v));
  if (a.weapon.base !== b.weapon.base) out.unshift({ up: true, text: `${T.exploits[a.weapon.base].name} → ${T.exploits[b.weapon.base].name}` });
  return out;
}

// ---------------------------------------------------------------------------
// The title screen's code rain
// ---------------------------------------------------------------------------
const Rain = { on: false, cols: [], raf: 0 };
function startRain() {
  const c = $('rain');
  if (Rain.on) return;
  Rain.on = true;
  const fit = () => {
    const r = c.getBoundingClientRect();
    c.width = Math.max(1, Math.floor(r.width / 2)); c.height = Math.max(1, Math.floor(r.height / 2));
    const n = Math.ceil(c.width / 6);
    Rain.cols = Array.from({ length: n }, () => ({ y: Math.random() * c.height - 20, v: 20 + Math.random() * 50 }));
  };
  fit();
  const x = c.getContext('2d');
  let last = performance.now();
  const tick = (now) => {
    if (!Rain.on) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    x.fillStyle = 'rgba(0,0,0,0.12)';
    x.fillRect(0, 0, c.width, c.height);
    const calm = Save.settings.reducedFlash;
    for (let i = 0; i < Rain.cols.length; i++) {
      const col = Rain.cols[i];
      col.y += col.v * dt * (calm ? 0.4 : 1);
      if (col.y > c.height + 20) { col.y = -10 - Math.random() * 60; col.v = 20 + Math.random() * 50; }
      const ch = '01アイウエオカキクケコｱｲｳｴｵ7Z:.=*+-<>'[(Math.random() * 28) | 0];
      drawText3(x, /[A-Z0-9:.=*+\-<>]/.test(ch) ? ch : '01'[(Math.random() * 2) | 0], i * 6, Math.round(col.y), Math.random() < 0.1 ? '#eaffef' : '#3cff6e', { shadow: null });
    }
    Rain.raf = requestAnimationFrame(tick);
  };
  Rain.raf = requestAnimationFrame(tick);
  Rain.fit = fit;
}
function stopRain() { Rain.on = false; cancelAnimationFrame(Rain.raf); }
