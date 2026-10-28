// Faint neural-network backdrop for the login and admin pages.
// Same visual language as the marketing site's galaxy (glowing nodes drifting in 3D, links that fade
// with distance, small pulses travelling along links) — simplified for the portal: no hero anchor,
// no scroll or pointer interaction, so it never gets in the way of a form.
// Pauses when the tab is hidden; shows one still frame if the visitor prefers reduced motion.
const TAU = Math.PI * 2, rnd = Math.random;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;

export function startNeuralBackground({ faint = 0.8 } = {}) {
  if (document.querySelector("canvas.neural-bg")) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.createElement("canvas");
  canvas.className = "neural-bg"; canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let w = 0, h = 0, R = 300, F = 700, XS = 1, nodes = [], dust = [], pulses = [];
  const PIT = 1.0, cp = Math.cos(PIT), sp = Math.sin(PIT);

  function sprite(rgb) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(.18, `rgba(${rgb},.55)`);
    gr.addColorStop(.5, `rgba(${rgb},.12)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return c;
  }
  const SB = sprite("92,138,255"), SW = sprite("226,236,255");
  const depthAlpha = (sc) => clamp((sc - .6) / .8, .15, 1);
  const smooth = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };

  // points are scattered through the volume; they drift outward and re-seed near the centre
  function seed(o, whole) {
    const r = R * (whole ? .95 : .5) * Math.sqrt(rnd()), a = rnd() * TAU;
    o.x = r * Math.cos(a); o.z = r * Math.sin(a); o.y = gauss() * R * .22;
    o.th = rnd() * TAU; o.tp = (rnd() - .5) * 2;
  }
  function make() {
    const n = clamp(Math.round(w * h / 13000), w < h ? 60 : 40, 84);
    nodes = Array.from({ length: n }, () => {
      const o = { f: 1, b: 1, vr: .5 + rnd(), sz: 1.3 + rnd() * 1.7, white: rnd() < .3, mv: rnd() < .35, x: 0, y: 0, z: 0, px: 0, py: 0, sc: 1, k: [] };
      seed(o, true); return o;
    });
    dust = Array.from({ length: n * 2 }, () => { const o = { f: 1, b: 1, vr: .4 + rnd() * .8, x: 0, y: 0, z: 0, px: 0, py: 0, sc: 1 }; seed(o, true); return o; });
    pulses = [];
  }
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const nw = window.innerWidth, nh = window.innerHeight;
    // ignore mobile URL-bar height jitter; rebuild only on a real size change
    if (nodes.length && nw === w && Math.abs(nh - h) < 160 && nh <= h) return;
    w = nw; h = nh;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = Math.hypot(w, h) * .5; F = R * 2.4;
    XS = w < h ? clamp(w / h * 1.5, .55, 1) : 1;   // portrait: pull the mesh in horizontally so it fills a narrow screen
    make();
    if (reduce) { for (let i = 0; i < 60; i++) step(.05); draw(9, 0); }
  }

  function step(dt) {
    const move = (o) => {
      const d = Math.hypot(o.x, o.z) || 1, out = R * .004 * o.vr, wv = R * .003;
      o.th += (rnd() - .5) * dt * 1.2; o.tp += (rnd() - .5) * dt * 1.2;
      o.x += (o.x / d * out + Math.cos(o.th) * Math.cos(o.tp) * wv) * dt;
      o.z += (o.z / d * out + Math.sin(o.th) * Math.cos(o.tp) * wv) * dt;
      o.y += Math.sin(o.tp) * wv * dt;
      const u = d / (R * .98);
      if (u > 1.05 || Math.abs(o.y) > R * .6) { seed(o, false); o.b = 0; }
      if (o.b < 1) o.b = Math.min(1, o.b + dt * .3);          // ~3s fade-in after re-seeding
      o.f = Math.min(o.b, 1 - smooth(.85, 1.05, u));
    };
    nodes.forEach(move); dust.forEach(move);
  }
  function proj(o, cx, cy) {
    const y2 = o.y * cp - o.z * sp, z2 = o.y * sp + o.z * cp;
    o.sc = F / (F + z2); o.px = cx + o.x * o.sc * XS; o.py = cy + y2 * o.sc;
  }

  function draw(t, dt) {
    const e = (1 - Math.pow(1 - clamp(t / 2.2, 0, 1), 3)) * faint;     // gentle fade-in, then a constant faint level
    const cx = w / 2, cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";

    // soft glow at the centre, behind the card
    ctx.save(); ctx.translate(cx, cy); ctx.scale(1, .62);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * .6);
    g.addColorStop(0, `rgba(60,110,255,${.1 * e})`); g.addColorStop(.4, `rgba(36,81,245,${.035 * e})`); g.addColorStop(1, "rgba(36,81,245,0)");
    ctx.fillStyle = g; ctx.fillRect(-R * .62, -R * .62, R * 1.24, R * 1.24); ctx.restore();

    ctx.fillStyle = "#a9c0ff";
    dust.forEach((d) => { proj(d, cx, cy); ctx.globalAlpha = depthAlpha(d.sc) * .3 * e * d.f; ctx.fillRect(d.px, d.py, 1.2 * d.sc, 1.2 * d.sc); });
    nodes.forEach((o) => { proj(o, cx, cy); o.k.length = 0; });

    // links by 3D proximity
    const LD = R * .3;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z, d2 = dx * dx + dy * dy + dz * dz;
        const both = a.mv && b.mv, lim = both ? LD * 1.6 : LD;
        if (d2 < lim * lim) {
          a.k.push(j); b.k.push(i);
          const al = Math.pow(1 - Math.sqrt(d2) / lim, 1.3) * (both ? .3 : .22) * Math.min(depthAlpha(a.sc), depthAlpha(b.sc)) * Math.min(a.f, b.f) * e;
          ctx.globalAlpha = 1; ctx.strokeStyle = `rgba(96,140,255,${al})`; ctx.lineWidth = .8 * (a.sc + b.sc) / 2;
          ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
        }
      }
    }

    // a few small dots travel along links
    if (!reduce && pulses.length < 4 && rnd() < .02 * dt * 60) {
      const i = rnd() * nodes.length | 0, ks = nodes[i].k;
      if (ks.length) pulses.push({ a: i, b: ks[rnd() * ks.length | 0], t: 0, sp: .6 + rnd() * .5 });
    }
    pulses = pulses.filter((p) => {
      const A = nodes[p.a], B = nodes[p.b];
      p.t += dt * p.sp;
      if (p.t >= 1 || A.f < .3 || B.f < .3) return false;
      ctx.globalAlpha = 1; ctx.fillStyle = `rgba(190,208,255,${Math.sin(Math.PI * p.t) * .9 * e})`;
      ctx.beginPath(); ctx.arc(A.px + (B.px - A.px) * p.t, A.py + (B.py - A.py) * p.t, 1.7 * (A.sc + B.sc) / 2, 0, TAU); ctx.fill();
      return true;
    });

    nodes.forEach((o) => {
      const r = o.sz * 5 * o.sc, d = depthAlpha(o.sc) * o.f;
      ctx.globalAlpha = d * .5 * e * (o.b < 1 ? 1 : 1); ctx.drawImage(o.white ? SW : SB, o.px - r, o.py - r, r * 2, r * 2);
      const c = o.sz * 1.2 * o.sc; ctx.globalAlpha = d * e; ctx.drawImage(SW, o.px - c, o.py - c, c * 2, c * 2);
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }

  let raf = 0, T = 0, last = 0;
  const loop = (now) => {
    const dt = Math.min(.05, (now - last) / 1000); last = now; T += dt;
    step(dt); draw(T, dt);
    raf = requestAnimationFrame(loop);
  };
  const start = () => { if (!raf && !reduce && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop); } };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };

  resize();
  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  start();
}
