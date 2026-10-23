/* Wisejet Cranes — shared behaviour */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const solid = document.body.hasAttribute('data-solid');
  const hdr = $('#hdr'), bar = $('#progress'), topBtn = $('#top-btn');

  const onScroll = () => {
    const y = window.scrollY, h = document.documentElement.scrollHeight - innerHeight;
    if (bar) bar.style.width = (h > 0 ? y / h * 100 : 0) + '%';
    if (hdr && !solid) hdr.classList.toggle('scrolled', y > 40);
    if (topBtn) topBtn.classList.toggle('show', y > 600);
    const links = $$('.menu a.l[href^="#"]');
    if (links.length) {
      let cur = -1;
      links.forEach((a, i) => { const s = $(a.getAttribute('href')); if (s && y >= s.offsetTop - 160) cur = i; });
      links.forEach((a, i) => a.classList.toggle('active', i === cur));
    }
  };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  topBtn?.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

  /* mobile drawer */
  const drawer = $('#drawer'), burger = $('#burger');
  const setDrawer = o => { drawer.classList.toggle('open', o); burger.setAttribute('aria-expanded', o); document.body.style.overflow = o ? 'hidden' : ''; };
  burger?.addEventListener('click', () => setDrawer(true));
  $('#drawer .x')?.addEventListener('click', () => setDrawer(false));
  $$('#drawer a').forEach(a => a.addEventListener('click', () => setDrawer(false)));

  /* reveal */
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .1 });
  $$('.rv').forEach(el => io.observe(el));

  /* counters */
  const co = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; co.unobserve(e.target);
    const el = e.target, t = +el.dataset.to, t0 = performance.now();
    const step = n => { const p = Math.min((n - t0) / 1400, 1); el.textContent = Math.round((1 - Math.pow(1 - p, 3)) * t); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }), { threshold: .5 });
  $$('[data-to]').forEach(el => co.observe(el));

  /* fleet explorer */
  const fleet = {
    light: { c: 'Light range', t: 'Compact mobile cranes', d: 'Quick to mobilise and set up. Well suited to building services, signage, utility maintenance and general site lifting where access is tight.', cap: '5 to 50 tonnes', use: 'Utility and light commercial lifts', note: 'Fast set-up',
      img: 'https://wisejetcranes.co.zw/wp-content/uploads/2023/11/PHOTO-2023-11-18-16-24-15-Copy.jpg' },
    medium: { c: 'Medium range', t: 'All-terrain hydraulic cranes', d: 'The workhorse range for structural steel, plant and equipment installation, and factory and warehouse work, with the reach and capacity most projects need.', cap: '50 to 120 tonnes', use: 'Steel erection and plant installation', note: 'Hydraulic outrigger base',
      img: 'https://wisejetcranes.co.zw/wp-content/uploads/2023/11/PHOTO-2023-11-15-16-40-30.jpg' },
    heavy: { c: 'Heavy range', t: 'High-capacity heavy lift cranes', d: 'For the largest loads, from industrial and mining equipment to major infrastructure components, with lifts planned and engineered around your site.', cap: '120 to 250 tonnes', use: 'Large industrial and infrastructure lifts', note: 'Planned and engineered lifts',
      img: 'https://wisejetcranes.co.zw/wp-content/uploads/2023/11/PHOTO-2023-11-20-14-35-55.jpg' }
  };
  const tabs = $$('.tab');
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => t.setAttribute('aria-selected', t === tab));
    const f = fleet[tab.dataset.f];
    $('#fClass').textContent = f.c; $('#fTitle').textContent = f.t; $('#fDesc').textContent = f.d;
    $('#fCap').textContent = f.cap; $('#fUse').textContent = f.use; $('#fNote').textContent = f.note;
    $('#fImg').src = f.img;
  }));

  /* estimator (indicative only) */
  const L = $('#eLoad'), R = $('#eRad'), T = $('#eTerrain');
  if (L && R && T) {
    const tiers = [[30, 'Light range crane', 'Up to roughly 30 tonne class'], [60, 'Light to medium crane', 'Roughly 30 to 60 tonne class'], [120, 'Medium range crane', 'Roughly 60 to 120 tonne class'], [200, 'Heavy range crane', 'Roughly 120 to 200 tonne class'], [Infinity, 'Heavy lift planning required', '200 tonne class and above']];
    const ground = { solid: 'Standard set-up on firm ground', dirt: 'Ground check recommended', soft: 'Outrigger mats and ground assessment required' };
    let last = {};
    const calc = () => {
      const load = +L.value, rad = +R.value;
      const f = rad <= 6 ? 1.5 : rad <= 12 ? 2.5 : rad <= 20 ? 3.5 : 5;
      const need = Math.round(load * f);
      const tier = tiers.find(t => need <= t[0]);
      $('#eLoadV').textContent = load + ' tonnes'; $('#eRadV').textContent = rad + ' m';
      $('#rClass').textContent = tier[1]; $('#rCap').textContent = tier[2];
      $('#rNeed').textContent = '~' + need + ' tonnes'; $('#rGround').textContent = ground[T.value];
      last = { load, rad, tier: tier[1], terrain: T.options[T.selectedIndex].text };
    };
    [L, R, T].forEach(e => e.addEventListener('input', calc)); calc();
    $('#ePrefill')?.addEventListener('click', e => {
      e.preventDefault();
      const m = $('#fMsg'); if (m) m.value = `Estimator result: ${last.load} tonne load at ${last.rad} m working radius, ground: ${last.terrain}. Indicative class: ${last.tier}.`;
      $('#contact').scrollIntoView({ behavior: 'smooth' });
    });
  }

  /* faq */
  const qs = $$('.faq button');
  qs.forEach(b => b.addEventListener('click', () => {
    const open = b.getAttribute('aria-expanded') === 'true';
    qs.forEach(o => { o.setAttribute('aria-expanded', 'false'); o.nextElementSibling.style.maxHeight = '0'; });
    if (!open) { b.setAttribute('aria-expanded', 'true'); b.nextElementSibling.style.maxHeight = b.nextElementSibling.scrollHeight + 'px'; }
  }));

  /* lightbox */
  const lb = $('#lb');
  if (lb) {
    const img = $('img', lb);
    $$('.gal a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); img.src = a.href; lb.classList.add('on'); }));
    lb.addEventListener('click', () => lb.classList.remove('on'));
    addEventListener('keydown', e => { if (e.key === 'Escape') lb.classList.remove('on'); });
  }

  /* blog filters */
  const fb = $$('.filters button');
  fb.forEach(b => b.addEventListener('click', () => {
    fb.forEach(x => x.classList.remove('on')); b.classList.add('on');
    $$('#posts .post').forEach(p => p.classList.toggle('hide', b.dataset.f !== 'All' && p.dataset.cat !== b.dataset.f));
  }));

  /* quote form -> WhatsApp */
  $('#qf')?.addEventListener('submit', e => {
    e.preventDefault();
    const v = id => encodeURIComponent($(id).value.trim());
    const txt = `Hello Wisejet Cranes, I would like a quote.%0AName: ${v('#fName')}%0APhone: ${v('#fPhone')}%0AService: ${v('#fSvc')}%0ALocation: ${v('#fLoc')}%0ADetails: ${v('#fMsg')}`;
    open('https://wa.me/263718323920?text=' + txt, '_blank', 'noopener');
  });

  const yr = $('#yr'); if (yr) yr.textContent = new Date().getFullYear();
})();
