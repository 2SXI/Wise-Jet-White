(function(){
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Header scroll state */
  const header = document.getElementById('header');
  const progress = document.getElementById('progress');
  function onScroll(){
    header.classList.toggle('scrolled', window.scrollY > 8);
    const h = document.documentElement;
    const scrollPct = (h.scrollTop || document.body.scrollTop) / ((h.scrollHeight || document.body.scrollHeight) - h.clientHeight) * 100;
    progress.style.width = scrollPct + '%';
  }
  document.addEventListener('scroll', onScroll, {passive:true});
  onScroll();

  /* Mobile menu */
  const burger = document.getElementById('burger');
  const menu = document.getElementById('mobile-menu');
  function closeMenu(){
    burger.classList.remove('open'); menu.classList.remove('open'); document.body.classList.remove('menu-open');
    burger.setAttribute('aria-expanded','false');
    document.body.style.overflow = '';
  }
  burger.addEventListener('click', () => {
    const open = burger.classList.toggle('open');
    menu.classList.toggle('open', open); document.body.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', open ? 'true':'false');
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.style.overflow = open ? 'hidden' : '';
  });
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
  document.addEventListener('click', e => { if (menu.classList.contains('open') && !menu.contains(e.target) && !e.target.closest('header')) closeMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu.classList.contains('open')) { closeMenu(); burger.focus(); } });
  window.addEventListener('resize', () => { if (window.innerWidth > 920) closeMenu(); });

  /* Active nav link based on current page */
  (function(){
    const path = (location.pathname.split('/').pop() || 'index.html');
    document.querySelectorAll('[data-nav]').forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === path);
    });
  })();

  /* Scroll reveal */
  function animateCount(el){
    const target = parseFloat(el.getAttribute('data-count'));
    const suffix = el.getAttribute('data-suffix') || '';
    const decimals = parseInt(el.getAttribute('data-decimals'), 10) || 0;
    if(reduceMotion || !target){ el.textContent = target.toFixed(decimals) + suffix; return; }
    const dur = 1100;
    const start = performance.now();
    function tick(now){
      const p = Math.min(1, (now-start)/dur);
      const eased = 1 - Math.pow(1-p, 3);
      el.textContent = (target*eased).toFixed(decimals) + suffix;
      if(p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  if('IntersectionObserver' in window){
    const countIo = new IntersectionObserver((entries) => {
      entries.forEach(e => { if(e.isIntersecting){ animateCount(e.target); countIo.unobserve(e.target); } });
    }, {threshold:0.6});
    document.querySelectorAll('[data-count]').forEach(el => countIo.observe(el));
  } else {
    document.querySelectorAll('[data-count]').forEach(animateCount);
  }

  if(!reduceMotion && 'IntersectionObserver' in window){
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
    }, {threshold:0.14, rootMargin:'0px 0px -40px 0px'});
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));
  }

  /* Process scroll-linked progress */
  const processSection = document.getElementById('process');
  const processFill = document.getElementById('processFill');
  const steps = document.querySelectorAll('.process-step');
  function updateProcess(){
    if(!processSection) return;
    const r = processSection.getBoundingClientRect();
    const vh = window.innerHeight;
    let pct = (vh*0.75 - r.top) / (r.height*0.6);
    pct = Math.max(0, Math.min(1, pct));
    processFill.style.width = (pct*100) + '%';
    const activeIndex = Math.min(steps.length-1, Math.floor(pct * steps.length));
    steps.forEach((s,i) => s.classList.toggle('active', i <= activeIndex && pct > 0.02));
  }
  document.addEventListener('scroll', updateProcess, {passive:true});
  window.addEventListener('resize', updateProcess);
  updateProcess();

  /* Hero floating-card parallax (desktop only) */
  const heroStage = document.querySelector('.hero-stage');
  if(heroStage && !reduceMotion && window.matchMedia('(pointer:fine)').matches){
    const parallaxEls = heroStage.querySelectorAll('[data-depth]');
    heroStage.addEventListener('pointermove', (e) => {
      const rect = heroStage.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / rect.width - 0.5;
      const cy = (e.clientY - rect.top) / rect.height - 0.5;
      parallaxEls.forEach(el => {
        const depth = parseFloat(el.getAttribute('data-depth')) || 20;
        const tx = cx * depth;
        const ty = cy * depth;
        if(el.classList.contains('hero-orb')){
          el.style.transform = `perspective(1400px) rotateY(${-3 - cx*6}deg) rotateX(${2 - cy*6}deg) translate(${tx*0.3}px, ${ty*0.3}px)`;
        } else {
          el.style.transform = `translate(${tx}px, ${ty}px)`;
        }
      });
    }, {passive:true});
    heroStage.addEventListener('pointerleave', () => {
      parallaxEls.forEach(el => { el.style.transform = ''; });
    });
  }

  /* Magnetic + glow hover on nav links and primary CTAs: subtle pull toward cursor,
     glow follows pointer position within the element */
  if(!reduceMotion && window.matchMedia('(pointer:fine)').matches){
    document.querySelectorAll('.nav-links a, .btn-primary').forEach(el => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const mx = ((e.clientX - r.left) / r.width) * 100;
        const my = ((e.clientY - r.top) / r.height) * 100;
        el.style.setProperty('--mx', mx + '%');
        el.style.setProperty('--my', my + '%');
        if(el.matches('.nav-links a')){
          const px = (e.clientX - r.left) / r.width - 0.5;
          const py = (e.clientY - r.top) / r.height - 0.5;
          el.style.transform = `translate(${px*6}px, ${py*4}px)`;
        }
      }, {passive:true});
      el.addEventListener('pointerleave', () => { el.style.transform = ''; }, {passive:true});
    });
  }

  /* Magnetic buttons — primary/ghost CTAs nudge toward the cursor on approach, snap back on leave */
  if(!reduceMotion && window.matchMedia('(pointer:fine)').matches){
    document.querySelectorAll('.btn-primary, .btn-ghost').forEach(btn => {
      let raf = null;
      btn.addEventListener('pointermove', (e) => {
        const rect = btn.getBoundingClientRect();
        const relX = e.clientX - (rect.left + rect.width/2);
        const relY = e.clientY - (rect.top + rect.height/2);
        if(raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          btn.style.transform = `translate(${relX*0.22}px, ${relY*0.32}px)`;
        });
      });
      btn.addEventListener('pointerleave', () => {
        if(raf) cancelAnimationFrame(raf);
        btn.style.transform = '';
      });
    });
  }

  /* Cursor spotlight (desktop only, ignores reduced motion since it's a passive glow, not motion) */
  const spotlight = document.getElementById('spotlight');
  if(spotlight && window.matchMedia('(pointer:fine)').matches){
    let sx=50, sy=30, shown=false;
    window.addEventListener('pointermove', (e) => {
      sx = (e.clientX/window.innerWidth)*100;
      sy = (e.clientY/window.innerHeight)*100;
      spotlight.style.setProperty('--sx', sx+'%');
      spotlight.style.setProperty('--sy', sy+'%');
      if(!shown){ spotlight.classList.add('on'); shown = true; }
    }, {passive:true});
    window.addEventListener('pointerleave', () => spotlight.classList.remove('on'));
  }



  const form = document.getElementById('contactForm');
  const success = document.getElementById('formSuccess');
  if(form && success){
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      success.classList.add('show');
      form.reset();
    });
  }

  /* ---------- Galaxy neural network ----------
     One live 3D system drawn on the fixed background canvas. Nodes orbit a luminous core with
     differential rotation (inner faster than outer) and free-floating zero-g wobble; links form and
     fade by real 3D distance, so the mesh stays connected while it drifts. Energy pulses travel
     along links and fire the nodes they reach, which cascade onward like neurons. The galaxy's
     centre sits where the hero stage is, then eases to screen centre as the page scrolls. */
  (function initGalaxyNetwork(){
    const canvas = document.getElementById('neuralBg');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    const anchor = document.querySelector('.hero-orb-wrap');
    const LITE = window.matchMedia('(pointer:coarse)').matches || window.innerWidth < 820;   // phones/tablets: lighter galaxy
    const rnd = Math.random, TAU = Math.PI*2, clamp = (v,a,b) => Math.max(a, Math.min(b, v));
    const gauss = () => (rnd()+rnd()+rnd()-1.5)/1.5;
    let w=0, h=0, dpr=1, R=300, ax=0, ay=0, nodes=[], dust=[], pulses=[], born=[], rings=[];
    // travelling dots run on their own clock, independent of how slowly the network itself drifts
    // (links crossed per second: ~0.6-1.1, i.e. one link in roughly 1-1.7s)
    const PULSE_MIN = .6, PULSE_VAR = .5;
    let cyw=1, syw=0, cp=1, sp=0, F=700;
    let orbs=[], cur=null, stopX=0, stopY=0, lastMove=0, hadMove=false, ptype='mouse';   // orbs form where the cursor last stopped
    let sxs=null, sys=0, SX=0, SZ=0;   // flow source: eases toward the last stopped position   // glow/source: screen pos (smoothed cursor) and its world-plane equivalent
    let grab=null, gdx=0, gdy=0, gx=0, gy=0, gn=[];
    let tmx=0, tmy=0, mx=0, my=0, pmx=-999, pmy=-999, ptr=false;

    function sprite(rgb){
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32,32,0,32,32,32);
      gr.addColorStop(0,`rgba(${rgb},1)`); gr.addColorStop(.18,`rgba(${rgb},.55)`);
      gr.addColorStop(.5,`rgba(${rgb},.12)`); gr.addColorStop(1,`rgba(${rgb},0)`);
      g.fillStyle = gr; g.fillRect(0,0,64,64); return c;
    }
    const SB = sprite('92,138,255'), SW = sprite('226,236,255');
    const da = sc => clamp((sc-.6)/.8, .15, 1);

    function measure(){
      if(!anchor) return;
      const r = anchor.getBoundingClientRect();
      ax = r.left + r.width/2; ay = r.top + window.scrollY + r.height/2;
    }
    // points are scattered at random through the volume - no arms, no orbit, no centre-of-rotation
    function seed(o, whole){
      const r = R*(whole ? 1.3 : .55)*Math.sqrt(rnd()), a = rnd()*TAU;
      o.x = SX + r*Math.cos(a); o.z = SZ + r*Math.sin(a); o.y = gauss()*R*.22;
      o.th = rnd()*TAU; o.tp = (rnd()-.5)*2; o.ox = o.oy = 0;
    }
    function make(){
      const n = LITE ? clamp(Math.round(w*h/16000), 30, 48) : clamp(Math.round(w*h/14000), 44, 100);
      nodes = Array.from({length:n}, (_, i) => {
        const o = { i, f:1, b:1, vr:.5 + rnd()*1, sz:1.3 + rnd()*1.7, w:rnd()<.3, glow:0, mv:rnd()<.35, ox:0, oy:0, x:0, y:0, z:0, px:0, py:0, sc:1, k:[] };
        seed(o, true); return o;
      });
      dust = Array.from({length:LITE ? n*3 : n*2}, () => { const o = { f:1, b:1, vr:.4 + rnd()*.8, x:0, y:0, z:0, px:0, py:0, sc:1 }; seed(o, true); return o; });
      pulses = []; born = []; rings = [];
    }
    let lastW = 0;
    function resize(){
      if(nodes.length && window.innerWidth === w && Math.abs(window.innerHeight - h) < 160 && window.innerHeight <= h) return;
      dpr = LITE ? 1 : Math.min(window.devicePixelRatio||1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w*dpr; canvas.height = h*dpr;
      canvas.style.width = w+'px'; canvas.style.height = h+'px';
      ctx.setTransform(dpr,0,0,dpr,0,0);
      R = Math.hypot(w,h)*.5;
      measure();
      if(!nodes.length || w !== lastW){ lastW = w; make(); }
      if(reduceMotion) draw(9, 0);
    }

    const sm = (a,b,x) => { x = clamp((x-a)/(b-a),0,1); return x*x*(3-2*x); };
    function advance(o, dt){
      const rx = o.x - SX, rz = o.z - SZ, d = Math.hypot(rx, rz) || 1, out = R*.004*o.vr, wv = R*.003;
      o.th += (rnd()-.5)*dt*1.2; o.tp += (rnd()-.5)*dt*1.2;      // heading meanders smoothly
      o.x += (rx/d*out + Math.cos(o.th)*Math.cos(o.tp)*wv)*dt;   // drift away from the glow/cursor
      o.z += (rz/d*out + Math.sin(o.th)*Math.cos(o.tp)*wv)*dt;
      o.y += Math.sin(o.tp)*wv*dt;
      const u = d/(R*1.3);
      if(u > 1.05 || Math.abs(o.y) > R*.6){ seed(o, false); o.b = 0; o.glow = 0; if(grab === o) grab = null; }
      if(o.b < 1) o.b = Math.min(1, o.b + dt*.3);                // ~3s fade-in
      o.f = Math.min(o.b, 1 - sm(.85, 1.05, u));
    }
    function proj(o, cx, cy){
      const x1 = o.x*cyw + o.z*syw, z1 = -o.x*syw + o.z*cyw;
      const y2 = o.y*cp - z1*sp, z2 = o.y*sp + z1*cp;
      o.sc = F/(F + z2); o.px = cx + x1*o.sc; o.py = cy + y2*o.sc;
    }
    function spawn(i, from, gen){
      const ks = nodes[i].k.filter(j => j !== from);
      if(!ks.length || pulses.length + born.length > 90) return;
      born.push({ a:i, b:ks[rnd()*ks.length|0], t:0, sp:PULSE_MIN + rnd()*PULSE_VAR, g:gen });
    }

    let lastSpawn = 0;
    function draw(t, dt){
      const e = 1 - Math.pow(1 - clamp(t/2.2,0,1), 3);
      const s = clamp(window.scrollY/(h*.9), 0, 1);
      let cx = ax, cy = ay - window.scrollY;
      if(w < 980){ cx = w*.5; cy = h*.5; } else { cx += (w*.5 - cx)*s; cy += (h*.5 - cy)*s; }
      mx += (tmx-mx)*.04; my += (tmy-my)*.04;
      const yaw = 0, pit = 1.0;
      cyw = Math.cos(yaw); syw = Math.sin(yaw); cp = Math.cos(pit); sp = Math.sin(pit); F = R*2.4;
      const nowS = performance.now()/1000, still = nowS - lastMove > .4;
      if(sxs === null){
        sxs = cx; sys = cy; stopX = cx; stopY = cy;
        cur = { x:cx, y:cy, i:reduceMotion ? .55 : 0, max:.55 }; orbs.push(cur);
      }
      if(hadMove && ptr){
        if(!still) cur = null;                                   // cursor moving: current orb dissolves
        else if(!cur){ stopX = pmx; stopY = pmy; cur = { x:pmx, y:pmy, i:0, max:1 }; orbs.push(cur); }   // stopped: a new orb starts forming here
      }
      orbs.forEach(o => { if(o === cur) o.i += (o.max-o.i)*(1-Math.exp(-dt*.6)); else o.i -= dt*.45; });
      orbs = orbs.filter(o => o === cur || o.i > .01);
      const kk = 1 - Math.exp(-dt*1.4);
      sxs += (stopX - sxs)*kk; sys += (stopY - sys)*kk;
      SX = sxs - cx; SZ = -(sys - cy)/sp;
      if(!reduceMotion){ nodes.forEach(o => advance(o,dt)); dust.forEach(o => advance(o,dt)); }
      else { nodes.forEach(o => advance(o,0)); dust.forEach(o => advance(o,0)); }
      ctx.clearRect(0,0,w,h);
      ctx.globalCompositeOperation = 'lighter';

      // orbs: slowly generated where the cursor last stopped, dissolving once it moves on
      orbs.forEach(o => {
        ctx.save(); ctx.translate(o.x,o.y); ctx.scale(1,.62);
        const g = ctx.createRadialGradient(0,0,0,0,0,R*.6);
        g.addColorStop(0,`rgba(60,110,255,${.1*e*o.i})`); g.addColorStop(.4,`rgba(36,81,245,${.035*e*o.i})`); g.addColorStop(1,'rgba(36,81,245,0)');
        ctx.fillStyle = g; ctx.fillRect(-R*.62,-R*.62,R*1.24,R*1.24);
        ctx.globalAlpha = .2*e*o.i; ctx.drawImage(SB,-R*.07,-R*.07,R*.14,R*.14);
        ctx.restore();
      });
      // unconnected star dust gives the disc depth
      ctx.fillStyle = '#a9c0ff';
      dust.forEach(d => { proj(d,cx,cy); ctx.globalAlpha = da(d.sc)*.3*e*d.f; ctx.fillRect(d.px, d.py, 1.2*d.sc, 1.2*d.sc); });

      nodes.forEach(o => {
        proj(o,cx,cy);
        if(grab === o){ gx = pmx-gdx-o.px; gy = pmy-gdy-o.py; }
        if(grab === o){ o.ox += (gx-o.ox)*.35; o.oy += (gy-o.oy)*.35; }   // released nodes keep their position
        o.px += o.ox; o.py += o.oy; o.k.length = 0;
      });

      // links by 3D proximity
      const LD = R*(LITE ? .3 : .26), LD2 = LD*LD;
      for(let i=0;i<nodes.length;i++){
        const a = nodes[i];
        for(let j=i+1;j<nodes.length;j++){
          const b = nodes[j], dx=a.x-b.x, dy=a.y-b.y, dz=a.z-b.z, d2 = dx*dx+dy*dy+dz*dz;
          const mv2 = a.mv && b.mv, lim = mv2 ? LD*1.6 : LD;
          if(d2 < lim*lim){
            a.k.push(j); b.k.push(i);
            const d = Math.sqrt(d2), al = Math.pow(1-d/lim,1.3)*(mv2 ? .3 : .22)*Math.min(da(a.sc),da(b.sc))*Math.min(a.f,b.f)*e;
            ctx.globalAlpha = 1; ctx.strokeStyle = `rgba(96,140,255,${al})`; ctx.lineWidth = .8*(a.sc+b.sc)/2;
            ctx.beginPath(); ctx.moveTo(a.px,a.py); ctx.lineTo(b.px,b.py); ctx.stroke();
          }
        }
      }

      gn = grab ? grab.k.slice() : [];

      // pulses: a single small dot travelling one link, sparse (max 5) - no trail, no cascade
      if(!reduceMotion && pulses.length < 5 && rnd() < .02*dt*60) spawn(rnd()*nodes.length|0, -1, 0);
      pulses = pulses.filter(p => {
        const A = nodes[p.a], B = nodes[p.b];
        p.t += dt*p.sp;
        if(p.t >= 1 || A.f < .3 || B.f < .3) return false;
        const x = A.px+(B.px-A.px)*p.t, y = A.py+(B.py-A.py)*p.t;
        ctx.globalAlpha = 1; ctx.fillStyle = `rgba(190,208,255,${Math.sin(Math.PI*p.t)*.9*e})`;
        ctx.beginPath(); ctx.arc(x, y, 1.7*(A.sc+B.sc)/2, 0, TAU); ctx.fill();
        return true;
      }).concat(born);
      born = [];

      // nodes
      nodes.forEach(o => {
        o.glow *= .95;
        const hl = ptr ? clamp(1 - Math.hypot(o.px-pmx, o.py-pmy)/120, 0, 1)*.45 : 0, gl = Math.max(o.glow, hl, (1-o.b)*.8);
        const r = o.sz*(5 + gl*8)*o.sc, d = da(o.sc)*o.f;
        ctx.globalAlpha = d*(.5 + gl*.4)*e; ctx.drawImage(o.w ? SW : SB, o.px-r, o.py-r, r*2, r*2);
        const c = o.sz*1.2*o.sc; ctx.globalAlpha = d*e; ctx.drawImage(SW, o.px-c, o.py-c, c*2, c*2);
      });

      rings.forEach(r => { ctx.globalAlpha = 1; ctx.strokeStyle = `rgba(150,185,255,${r.al})`; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(r.x,r.y,r.r,0,TAU); ctx.stroke(); r.r += 1.8; r.al -= .022; });
      rings = rings.filter(r => r.al > 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }

    window.addEventListener('pointermove', ev => { tmx = ev.clientX/w - .5; tmy = ev.clientY/h - .5; pmx = ev.clientX; pmy = ev.clientY; ptr = true; ptype = ev.pointerType; lastMove = performance.now()/1000; hadMove = true; }, {passive:true});
    window.addEventListener('pointerleave', () => { ptr = false; tmx = tmy = 0; }, {passive:true});
    function hit(x, y, any){
      let best = null, bd = any ? 26 : 30;
      nodes.forEach(o => { if(o.f < .4) return; const d = Math.hypot(o.px-x, o.py-y); if(d < bd){ bd = d; best = o; } });
      return best;
    }
    let moved = false, downX = 0, downY = 0;
    window.addEventListener('pointerdown', ev => {
      if(reduceMotion) return;
      const o = hit(ev.clientX, ev.clientY);
      if(!o) return;
      grab = o; gdx = ev.clientX - o.px; gdy = ev.clientY - o.py; moved = false; downX = ev.clientX; downY = ev.clientY;
      document.body.style.userSelect = 'none'; document.body.style.cursor = 'grabbing';
    }, {passive:true});
    window.addEventListener('pointermove', ev => {
      if(grab){ if(Math.hypot(ev.clientX-downX, ev.clientY-downY) > 4) moved = true; }
      else if(!reduceMotion && ev.pointerType === 'mouse') document.body.style.cursor = hit(ev.clientX, ev.clientY) ? 'grab' : '';
    }, {passive:true});
    function release(){
      if(!grab) return;
      if(!moved){ grab.glow = 1; rings.push({x:grab.px, y:grab.py, r:4, al:.8}); }
      grab = null; document.body.style.userSelect = ''; document.body.style.cursor = '';
    }
    window.addEventListener('pointerup', release, {passive:true});
    window.addEventListener('pointercancel', release, {passive:true});
    window.addEventListener('resize', resize, {passive:true});
    window.addEventListener('load', () => { measure(); if(reduceMotion) draw(9,0); });

    resize();
    if(!reduceMotion){
      let last = performance.now(), T = 0;
      let lastScroll = 0, lastDraw = 0, running = true;
      if(LITE) window.addEventListener('scroll', () => { lastScroll = performance.now(); }, {passive:true});
      document.addEventListener('visibilitychange', () => { running = !document.hidden; last = performance.now(); });
      let covered = false;                                       // opaque footer fills the screen: nothing of the galaxy is visible
      const ftr = document.querySelector('footer');
      if(ftr && 'IntersectionObserver' in window) new IntersectionObserver(es => { covered = es[0].isIntersecting; }, {rootMargin:'0px 0px -99% 0px'}).observe(ftr);
      const loop = now => {
        requestAnimationFrame(loop);
        if(!running || covered){ last = now; return; }        // tab hidden or footer covering the canvas: stop drawing
        if(LITE){
          if(now - lastScroll < 140){ last = now; return; }     // phone is scrolling: keep the last frame, don't repaint under the header
          if(now - lastDraw < 33) return;                       // ~30fps is plenty on a phone
          lastDraw = now;
        }
        const dt = Math.min(.05, (now-last)/1000); last = now; T += dt; draw(T, dt);
      };
      requestAnimationFrame(loop);
    }
  })();

})();

/* ---------- Work page: filters + preview modal ---------- */
(function(){
  var grid = document.getElementById('workGrid');
  var filters = document.querySelectorAll('.work-filter');
  if (grid && filters.length) {
    filters.forEach(function(btn){
      btn.addEventListener('click', function(){
        var f = btn.getAttribute('data-filter');
        filters.forEach(function(b){ var on = b === btn; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
        grid.querySelectorAll('.work-card').forEach(function(c){
          var cats = (c.getAttribute('data-cat') || '').split(' ');
          c.hidden = f === 'all' ? cats.indexOf('concepts') > -1 : cats.indexOf(f) < 0;
        });
      });
    });
  }
  var modal = document.getElementById('previewModal');
  if (!modal || typeof modal.showModal !== 'function') return;
  var frame = document.getElementById('previewFrame');
  var title = document.getElementById('previewTitle');
  var open = document.getElementById('previewOpen');
  function setDevice(d){
    modal.classList.toggle('phone', d === 'phone');
    modal.querySelectorAll('[data-device]').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-device') === d); });
  }
  document.querySelectorAll('[data-preview]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var url = btn.getAttribute('data-preview');
      title.textContent = (btn.getAttribute('data-title') || 'Preview') + ' · live demo';
      open.href = url;
      frame.src = url + (url.indexOf('?') > -1 ? '&' : '?') + 'embed=1';
      setDevice('desktop');
      modal.showModal();
    });
  });
  modal.querySelectorAll('[data-device]').forEach(function(b){ b.addEventListener('click', function(){ setDevice(b.getAttribute('data-device')); }); });
  document.getElementById('previewClose').addEventListener('click', function(){ modal.close(); });
  modal.addEventListener('click', function(e){ if (e.target === modal) modal.close(); });
  modal.addEventListener('close', function(){ frame.src = 'about:blank'; });
})();
