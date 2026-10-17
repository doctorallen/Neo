'use strict';
// The autopilot: a page-side player for the tests. installBot (run in the
// page) defines window.Bot, which plays through the same Input.bot interface
// a thumb would: it steps the game synchronously, fights by holding the aim
// stick on the nearest process (a human's aim wobbles; the aim assist
// catches most of it) and stepping away from whatever gets close, phases
// through packets about to land,
// uses Bullet Time when it's charged and a fight is busy, decrypts caches,
// equips whatever the compare verdict calls better, answers the phone and
// takes the first patch offered. With god set, Neo can't die (to prove every
// floor can be finished); without, it reports where and how runs end.

function installBot() {
  const Bot = {
    log: [], floorTimes: [], lastFloorAt: 0, stuck: 0, lastPos: null, decisions: 0,

    // a path step from Neo towards a point, over walkable tiles
    stepToward(tx, ty) {
      const room = Game.room, p = Game.player, w = room.w, h = room.h;
      const goal = [clamp(Math.floor(tx / TILE), 0, w - 1), clamp(Math.floor(ty / TILE), 0, h - 1)];
      const D = new Int16Array(w * h).fill(-1);
      const walk = (x, y) => { const v = room.t(x, y); return v === FLOOR || v === DOOR; };
      const q = [goal[1] * w + goal[0]]; D[q[0]] = 0;
      for (let qi = 0; qi < q.length; qi++) {
        const i = q[qi], x = i % w, y = (i / w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (D[j] >= 0 || !walk(nx, ny)) continue;
          D[j] = D[i] + 1; q.push(j);
        }
      }
      const px = Math.floor(p.x / TILE), py = Math.floor(p.y / TILE);
      if (px === goal[0] && py === goal[1]) return [tx - p.x, ty - p.y];
      let best = null, bd = D[py * w + px] >= 0 ? D[py * w + px] : 9999;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const d = D[ny * w + nx];
        if (d >= 0 && d < bd) { bd = d; best = [nx, ny]; }
      }
      if (!best) return [tx - p.x, ty - p.y];
      return [(best[0] + 0.5) * TILE - p.x, (best[1] + 0.5) * TILE - p.y];
    },

    go(dx, dy, speed = 1) {
      const m = Math.hypot(dx, dy);
      if (m < 1.5) { Input.bot.x = 0; Input.bot.y = 0; return; }
      Input.bot.x = (dx / m) * speed; Input.bot.y = (dy / m) * speed;
    },

    // the next room to head for: an unvisited side room (cache, oracle,
    // rabbit) that is one door away, else on along the path to the exit
    nextRoom() {
      const f = Game.run.floor, room = Game.room;
      for (const [d, l] of Object.entries(room.doors)) {
        if (l.hidden) continue;
        if (!l.to.visited && (l.to.kind === 'cache' || l.to.kind === 'oracle' || l.to.kind === 'rabbit')) return d;
      }
      // breadth-first towards the exit (or the boss)
      const target = f.rooms.find((r) => r.kind === 'exit' || r.kind === 'boss');
      const prev = new Map([[room, null]]), q = [room];
      while (q.length) {
        const r = q.shift();
        if (r === target) break;
        for (const [d, l] of Object.entries(r.doors)) if (!l.hidden && !prev.has(l.to)) { prev.set(l.to, [r, d]); q.push(l.to); }
      }
      let r = target, dir = null;
      while (prev.get(r)) { const [from, d] = prev.get(r); dir = d; if (from === room) break; r = from; }
      return dir;
    },

    resolveModal() {
      const run = Game.run, m = Game.modal;
      this.decisions++;
      UI.guarded = () => false;
      if (m === 'screen-compare') {
        const it = this.pendingItem || null;
        const btns = [...document.querySelectorAll('#compare-card .row .btn')];
        const verdict = document.querySelector('#compare-card .verdict');
        const better = verdict && verdict.classList.contains('up');
        (better ? btns[0] : btns[1]).click();
      } else if (m === 'screen-cache') {
        const opts = [...document.querySelectorAll('#cache-options .option')];
        let pick = opts.find((o) => o.querySelector('.verdict.up')) || opts[0];
        pick.click();
      } else if (m === 'screen-patch') {
        const o = document.querySelector('#patch-options .option');
        if (o) o.click(); else document.querySelector('#patch-extra .btn').click();
      } else if (m === 'screen-oracle') {
        const b = document.querySelector('#oracle-card .btn');
        b.click();
      } else if (m === 'screen-pause') UI.resume();
      else return false;
      return true;
    },

    // one decision per step
    tick() {
      const run = Game.run, p = Game.player, room = Game.room;
      Input.bot = Input.bot || { x: 0, y: 0 };
      if (!run || run.ended) return 'ended';
      Input.bot.aim = null;
      if (Game.modal) { if (!this.resolveModal()) return 'modal:' + Game.modal; return 'ok'; }
      if (Game.flow || Game.transition) { Input.bot.x = 0; Input.bot.y = 0; return 'ok'; }
      const live = Game.enemies.filter((e) => !e.dead && e.spawnT <= 0);
      if (live.length || roomSealed()) { this.aimAt(live); return this.fight(live); }
      // loot on the floor
      const drop = Game.drops.find((d) => d.kind === 'item' && !d.blocked);
      if (drop) { const [dx, dy] = this.stepToward(drop.x, drop.y); this.go(dx, dy); return 'ok'; }
      // an unopened cache, the Oracle, the phone
      for (const pr of room.props) {
        const { x, y } = propPos(pr);
        if ((pr.kind === 'cache' || pr.kind === 'rabbitcache') && !pr.open) { const [dx, dy] = this.stepToward(x, y); this.go(dx, dy); return 'ok'; }
        if (pr.kind === 'oracle' && !pr.spent) { const [dx, dy] = this.stepToward(x, y); this.go(dx, dy); return 'ok'; }
        if (pr.kind === 'phone' && room.cleared && !pr.answered) { const [dx, dy] = this.stepToward(x, y); this.go(dx, dy); return 'ok'; }
      }
      // a rabbit showing the way: wait for it
      if (Game.critters.some((c) => c.kind === 'rabbit')) { Input.bot.x = 0; Input.bot.y = 0; return 'ok'; }
      const dir = this.nextRoom();
      if (!dir) { Input.bot.x = 0; Input.bot.y = 0; return 'lost'; }
      const cells = room.doorCells(dir), [ddx, ddy] = DIRS[dir];
      const tx = ((cells[0][0] + cells[1][0]) / 2 + 0.5) * TILE + ddx * 8, ty = ((cells[0][1] + cells[1][1]) / 2 + 0.5) * TILE + ddy * 8;
      const [dx, dy] = this.stepToward(tx, ty);
      this.go(dx, dy);
      return 'ok';
    },

    // holds the aim stick towards the nearest process; with a skill model the
    // aim is off by a few degrees, re-rolled every 0.3 s like a thumb's wobble
    aimAt(live) {
      const p = Game.player;
      if (!live.length) return;
      const t = chooseTarget(p);
      if (!t) return;
      let a = Math.atan2(t.y - t.h / 2 - (p.y - 7), t.x - p.x);
      const sk = this.skill;
      if (sk && sk.aimErr) {
        if (!this.wobbleAt || Game.realT - this.wobbleAt > 0.3) { this.wobbleAt = Game.realT; this.wobble = (Math.random() * 2 - 1) * sk.aimErr * Math.PI / 180; }
        a += this.wobble;
      }
      Input.bot.aim = [Math.cos(a), Math.sin(a)];
    },

    fight(live) {
      const p = Game.player, run = Game.run;
      // a packet about to land: phase across its path, or step aside
      let threat = null, tmin = 0.45;
      // a human sees a packet a moment after it's fired, and misses some
      const sk = this.skill;
      for (const b of Game.bullets) {
        if (sk) {
          if (b._seenAt === undefined) { b._seenAt = Game.realT; b._noticed = Math.random() < sk.notice; }
          if (!b._noticed || Game.realT - b._seenAt < sk.react) continue;
        }
        const rx = b.x - p.x, ry = b.y - (p.y - 4), vx = b.vx, vy = b.vy;
        const v2 = vx * vx + vy * vy;
        const t = -(rx * vx + ry * vy) / (v2 || 1);
        if (t < 0 || t > tmin) continue;
        const cx = rx + vx * t, cy = ry + vy * t;
        if (cx * cx + cy * cy < 64) { tmin = t; threat = b; }
      }
      let near = null, nd = Infinity;
      for (const e of live) { const d = dist(e.x, e.y, p.x, p.y); if (d < nd) { nd = d; near = e; } }
      const charging = Game.enemies.some((e) => !e.dead && (e.state === 'dash' || e.state === 'lunge' || e.state === 'charge') && dist(e.x, e.y, p.x, p.y) < 50 && (!sk || Math.random() < sk.notice * 0.2));
      const storm = Game.hazards.find((h) => h.kind === 'storm' && p.x >= h.x0 - 3 && p.x < h.x1 + 3);
      if ((threat || charging) && p.phaseCdT <= 0) {
        const src = threat || near;
        const a = Math.atan2(src.vy || (src.y - p.y), src.vx || (src.x - p.x)) + Math.PI / 2;
        Input.bot.phase = [Math.cos(a), Math.sin(a)];
      }
      if (run.focus >= T.focus.max && (live.length >= 3 || (Game.boss && !Game.boss.dead))) Input.bot.focus = true;
      if (storm) {
        // out of the lit column, towards the nearer dark side
        const left = p.x - (storm.x0 - 4), right = storm.x1 + 4 - p.x;
        this.go(left < right ? -1 : 1, 0);
        return 'ok';
      }
      if (threat) { const a = Math.atan2(threat.vy, threat.vx) + Math.PI / 2; this.go(Math.cos(a), Math.sin(a)); return 'ok'; }
      // hold position and hack until something gets close; then step to the most open side
      const melee = live.filter((e) => e.type !== 'firewall' && e.type !== 'exile');
      const close = melee.filter((e) => dist(e.x, e.y, p.x, p.y) < 30);
      if (close.length) {
        let best = null, bs = -1;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2, tx = p.x + Math.cos(a) * 22, ty = p.y + Math.sin(a) * 22;
          if (!pathClear(Game.room, p, tx, ty) || circleBlocked(Game.room, tx, ty, p.r + 1, p)) continue;
          let m = Infinity;
          for (const e of melee) m = Math.min(m, dist(e.x, e.y, tx, ty));
          if (m > bs) { bs = m; best = a; }
        }
        if (best !== null) {
          if (p.phaseCdT <= 0 && close.some((e) => dist(e.x, e.y, p.x, p.y) < 12)) Input.bot.phase = [Math.cos(best), Math.sin(best)];
          this.go(Math.cos(best), Math.sin(best));
          return 'ok';
        }
      }
      // nothing in sight: get a line on the nearest
      if (near && !lineOfSight(Game.room, p.x, p.y - 6, near.x, near.y - near.h / 2)) { const [dx, dy] = this.stepToward(near.x, near.y); this.go(dx, dy); return 'ok'; }
      Input.bot.x = 0; Input.bot.y = 0;
      return 'ok';
    },

    // Plays until the run ends or `seconds` of game time pass.
    // skill: null plays perfectly; { react, notice } gives it a human's
    // reaction time and attention
    play({ god = false, seconds = 900, skill = null } = {}) {
      Game.debug.god = god;
      this.skill = skill;
      const out = { rooms: [], floors: [], end: null, hpLow: 1, stuck: [], errors: [], steps: 0, modals: 0 };
      let floor = Game.run.floorN, floorStart = Game.run.time, lastRoom = null, roomAt = 0;
      const maxSteps = seconds * 60;
      for (let i = 0; i < maxSteps; i++) {
        const st = this.tick();
        if (st === 'ended') break;
        if (st === 'lost' || st.startsWith('modal:')) { out.stuck.push(st + ' in ' + (Game.room && Game.room.kind)); if (out.stuck.length > 5) break; }
        try { Game.step(1 / 60); } catch (e) { out.errors.push(String(e.stack || e)); break; }
        out.steps++;
        const run = Game.run;
        if (!run) break;
        if (run.stats) out.hpLow = Math.min(out.hpLow, run.hp / run.stats.maxHp);
        if (run.floorN !== floor) { out.floors.push({ n: floor, time: +(run.time - floorStart).toFixed(1) }); floor = run.floorN; floorStart = run.time; }
        if (Game.room !== lastRoom) { if (lastRoom) out.rooms.push(`${run.floorN}:${lastRoom.kind}:${(run.time - roomAt).toFixed(1)}`); lastRoom = Game.room; roomAt = run.time; }
        // too long in one room: something's wrong
        if (run.time - roomAt > 90 && !Game.modal) {
          const room = Game.room, p = Game.player;
          const detail = `p=${p.x | 0},${p.y | 0} drops=[${Game.drops.map((d) => `${d.kind}@${d.x | 0},${d.y | 0}${d.blocked ? ' blocked' : ''}`).join(' ')}] props=[${room.props.map((q) => `${q.kind}@${q.tx},${q.ty}${q.open ? ' open' : ''}${q.spent ? ' spent' : ''}${q.answered ? ' answered' : ''}`).join(' ')}] critters=[${Game.critters.map((c) => `${c.kind}@${c.x | 0},${c.y | 0} t${c.t.toFixed(1)}`).join(' ')}] doors=[${Object.entries(room.doors).map(([d, l]) => `${d}:${l.to.kind}${l.hidden ? ' hidden' : ''}`).join(' ')}] next=${this.nextRoom()} bot=${JSON.stringify(Input.bot)} flow=${Game.flow && Game.flow.kind} transition=${!!Game.transition}`;
          out.stuck.push(`90 s in a ${room.kind} room on floor ${run.floorN} (${Game.enemies.filter((e) => !e.dead).length} left, sealed ${roomSealed()}) ${detail}`);
          break;
        }
        if (run.ended) break;
      }
      const run = Game.run;
      out.modals = this.decisions;
      out.floors.push({ n: run.floorN, time: +(run.time - floorStart).toFixed(1) });
      out.end = { victory: !!run.victory, ended: !!run.ended, floor: run.floorN, time: +run.time.toFixed(1), kills: run.kills, killedBy: run.killedBy, data: Math.floor(run.data), hp: Math.round(run.hp), patches: run.patches.slice(), gear: Object.fromEntries(Object.entries(run.gear).map(([k, v]) => [k, v ? `${v.name} (${v.rarity})` : null])) };
      out.errors.push(...Errors);
      Input.bot = null;
      return out;
    },
  };
  window.Bot = Bot;
}

module.exports = { installBot };
