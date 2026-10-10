(() => {
  'use strict';

  const $ = (sel, scope = document) => scope.querySelector(sel);
  const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];
  const clamp = (min, max, v) => Math.min(max, Math.max(min, v));
  const clock = (s) => {
    const t = Math.max(0, Math.floor(s || 0));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };
  const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  const STEP = 20;
  const TITLES = { menu: 'iPod', tracks: 'small hours', now: 'tocando agora' };

  function create(box) {
    const head = $('.ipod__head', box);
    const live = $('.ipod__live', box);
    const wheel = $('.ipod__wheel', box);
    const ring = $('.ipod__ring', box);
    const views = {};
    for (const v of $$('.ipod__view', box)) views[v.dataset.view] = v;
    const rows = { menu: $$('li', views.menu), tracks: $$('li', views.tracks) };
    const tracks = rows.tracks.map((li) => ({ title: $('span', li).textContent.trim(), src: li.dataset.src }));
    const np = {
      count: $('.now__count', box),
      title: $('.now__title', box),
      bar: $('.now__bar i', box),
      el: $('.now__el', box),
      left: $('.now__left', box),
      viz: $$('.now__viz i', box)
    };
    const mini = $('.miniplayer');
    const miniTitle = mini && $('.miniplayer__title', mini);

    let view = 'menu';
    const trail = [];
    const sel = { menu: 0, tracks: 0 };
    let current = -1;
    let playing = false;
    let visible = true;
    let audio = null;
    let actx = null;
    let analyser = null;
    let freq = null;

    const say = (text) => { if (live) live.textContent = text; };

    const wake = () => {
      if (!actx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { actx = new AC(); } catch (e) { return null; }
      }
      if (actx.state === 'suspended') actx.resume();
      return actx;
    };

    const ensureAudio = () => {
      if (audio) return audio;
      audio = new Audio();
      audio.preload = 'auto';
      audio.addEventListener('play', () => setPlaying(true));
      audio.addEventListener('pause', () => setPlaying(false));
      audio.addEventListener('ended', () => {
        if (current < tracks.length - 1) load(current + 1, true);
        else { audio.currentTime = 0; paint(); }
      });
      const c = location.protocol === 'file:' ? null : wake();
      if (c) {
        try {
          const src = c.createMediaElementSource(audio);
          analyser = c.createAnalyser();
          analyser.fftSize = 64;
          analyser.smoothingTimeConstant = 0.7;
          freq = new Uint8Array(analyser.frequencyBinCount);
          src.connect(analyser);
          analyser.connect(c.destination);
        } catch (e) {
          analyser = null;
        }
      }
      return audio;
    };

    const tick = () => {
      if (!actx || actx.state !== 'running') return;
      const t = actx.currentTime;
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      osc.type = 'square';
      osc.frequency.value = 2300;
      gain.gain.setValueAtTime(0.03, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
      osc.connect(gain);
      gain.connect(actx.destination);
      osc.start(t);
      osc.stop(t + 0.02);
    };

    const label = (list) => (list === 'menu'
      ? rows.menu[sel.menu].textContent.trim()
      : `${tracks[sel.tracks].title}, faixa ${sel.tracks + 1} de ${tracks.length}`);

    const mark = (list) => {
      rows[list].forEach((li, i) => li.classList.toggle('is-on', i === sel[list]));
      const li = rows[list][sel[list]];
      const pane = views[list];
      if (li.offsetTop < pane.scrollTop) pane.scrollTop = li.offsetTop;
      else if (li.offsetTop + li.offsetHeight > pane.scrollTop + pane.clientHeight) {
        pane.scrollTop = li.offsetTop + li.offsetHeight - pane.clientHeight;
      }
    };

    const show = (to, back = false) => {
      if (to === view) return;
      const from = views[view];
      const next = views[to];
      const gsap = window.gsap;
      next.hidden = false;
      if (gsap && !reducedMQ.matches) {
        gsap.killTweensOf([from, next]);
        gsap.fromTo(next, { xPercent: back ? -100 : 100 }, { xPercent: 0, duration: 0.32, ease: 'power2.out' });
        gsap.fromTo(from, { xPercent: 0 }, {
          xPercent: back ? 100 : -100,
          duration: 0.32,
          ease: 'power2.out',
          onComplete: () => {
            if (from !== views[view]) from.hidden = true;
            gsap.set(from, { xPercent: 0 });
          }
        });
      } else {
        from.hidden = true;
      }
      view = to;
      box.dataset.view = to;
      head.textContent = TITLES[to];
      if (to === 'now') { paint(); drawViz(); }
      if (to === 'menu' || to === 'tracks') mark(to);
      say(to === 'menu' || to === 'tracks' ? `${TITLES[to]}: ${label(to)}` : TITLES[to]);
      loop();
    };

    const open = (to) => {
      trail.push(view);
      show(to);
    };

    const back = () => {
      if (trail.length) show(trail.pop(), true);
    };

    const load = (i, autoplay) => {
      current = clamp(0, tracks.length - 1, i);
      sel.tracks = current;
      mark('tracks');
      const a = ensureAudio();
      a.src = tracks[current].src;
      box.classList.add('has-track');
      np.count.textContent = `${current + 1} de ${tracks.length}`;
      np.title.textContent = tracks[current].title;
      if (miniTitle) miniTitle.textContent = tracks[current].title;
      paint();
      if (autoplay) play();
    };

    const play = () => {
      const a = ensureAudio();
      if (current < 0) load(0, false);
      wake();
      const p = a.play();
      if (p && p.catch) p.catch(() => setPlaying(false));
    };

    const pause = () => {
      if (audio && !audio.paused) audio.pause();
    };

    const toggle = () => (playing ? pause() : play());

    const skip = (d) => {
      if (current < 0) {
        load(0, false);
        return;
      }
      if (d < 0 && audio.currentTime > 3) {
        audio.currentTime = 0;
        paint();
        return;
      }
      const i = current + d;
      if (i < 0 || i >= tracks.length) return;
      load(i, playing);
      say(`${tracks[i].title}, faixa ${i + 1} de ${tracks.length}`);
    };

    const setPlaying = (on) => {
      if (on === playing) return;
      playing = on;
      box.classList.toggle('is-playing', on);
      if (on && current >= 0) say(`tocando ${tracks[current].title}`);
      syncMini();
      loop();
    };

    const paint = () => {
      const d = audio && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 30;
      const t = audio && current >= 0 ? audio.currentTime : 0;
      np.bar.style.transform = `scaleX(${clamp(0, 1, t / d).toFixed(4)})`;
      const el = clock(t);
      const left = `-${clock(d - t)}`;
      if (np.el.textContent !== el) np.el.textContent = el;
      if (np.left.textContent !== left) np.left.textContent = left;
    };

    const levels = new Float32Array(np.viz.length);
    const drawViz = (time = 0) => {
      const n = levels.length;
      if (playing && !reducedMQ.matches) {
        if (analyser) {
          analyser.getByteFrequencyData(freq);
          for (let i = 0; i < n; i++) {
            const k = Math.round(1 + Math.pow(i / (n - 1), 1.35) * 21);
            levels[i] = freq[k] / 255;
          }
        } else {
          for (let i = 0; i < n; i++) levels[i] = 0.35 + 0.35 * Math.abs(Math.sin(time * 0.004 + i * 0.9));
        }
      } else {
        for (let i = 0; i < n; i++) levels[i] *= 0.85;
      }
      np.viz.forEach((bar, i) => { bar.style.transform = `scaleY(${Math.max(0.06, levels[i]).toFixed(3)})`; });
    };

    let raf = 0;
    const need = () => visible && view === 'now';
    const frame = (time) => {
      paint();
      drawViz(time);
      raf = need() ? requestAnimationFrame(frame) : 0;
    };
    const loop = () => {
      if (need() && !raf) raf = requestAnimationFrame(frame);
    };

    const step = (d) => {
      tick();
      if (view === 'menu' || view === 'tracks') {
        const s = clamp(0, rows[view].length - 1, sel[view] + d);
        if (s === sel[view]) return;
        sel[view] = s;
        mark(view);
        say(label(view));
      } else if (view === 'now') {
        if (audio && current >= 0 && isFinite(audio.duration)) {
          audio.currentTime = clamp(0, audio.duration - 0.05, audio.currentTime + d * 1.5);
          paint();
        }
      }
    };

    const choose = () => {
      if (view === 'menu') {
        const li = rows.menu[sel.menu];
        const to = li.dataset.open;
        if (to === 'spotify') { li.click(); return; }
        if (to === 'now' && current < 0) load(0, false);
        open(to);
      } else if (view === 'tracks') {
        load(sel.tracks, true);
        open('now');
      } else if (view === 'now') {
        toggle();
      }
    };

    let drag = null;
    const angleAt = (e) => {
      const r = wheel.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
    };
    wheel.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.ipod__center')) return;
      wake();
      drag = { id: e.pointerId, last: angleAt(e), acc: 0, turned: 0, captured: false };
    });
    wheel.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const a = angleAt(e);
      let d = a - drag.last;
      if (d > 180) d -= 360;
      else if (d < -180) d += 360;
      drag.last = a;
      drag.acc += d;
      drag.turned += Math.abs(d);
      if (!drag.captured && drag.turned > 8) {
        drag.captured = true;
        try { wheel.setPointerCapture(e.pointerId); } catch (err) { }
        box.classList.add('is-turning');
      }
      if (!drag.captured) return;
      while (drag.acc >= STEP) { drag.acc -= STEP; step(1); }
      while (drag.acc <= -STEP) { drag.acc += STEP; step(-1); }
    });
    const release = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      box.classList.remove('is-turning');
    };
    wheel.addEventListener('pointerup', release);
    wheel.addEventListener('pointercancel', release);

    box.addEventListener('click', (e) => {
      const hit = e.target.closest('button, li');
      if (!hit || !box.contains(hit)) return;
      wake();
      if (hit.matches('button')) tick();
      if (hit.matches('.ipod__key--menu')) back();
      else if (hit.matches('.ipod__key--play')) toggle();
      else if (hit.matches('.ipod__key--next')) skip(1);
      else if (hit.matches('.ipod__key--prev')) skip(-1);
      else if (hit.matches('.ipod__center')) choose();
      else if (hit.matches('li')) {
        const list = hit.closest('.ipod__view').dataset.view;
        if (list !== view) return;
        sel[list] = rows[list].indexOf(hit);
        mark(list);
        if (!hit.hasAttribute('data-modal')) choose();
      }
    });

    box.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key;
      const act =
        k === 'ArrowDown' ? () => step(1)
        : k === 'ArrowUp' ? () => step(-1)
        : k === 'ArrowRight' ? () => skip(1)
        : k === 'ArrowLeft' ? () => skip(-1)
        : k === 'Escape' || k === 'Backspace' ? back
        : (k === 'Enter' || k === ' ') && e.target === ring ? choose
        : null;
      if (!act) return;
      e.preventDefault();
      wake();
      act();
    });

    document.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('[data-modal="tpl-musica"]')) pause();
    }, true);

    let miniTimer = 0;
    const syncMini = () => {
      if (!mini) return;
      clearTimeout(miniTimer);
      const title = current >= 0 ? tracks[current].title : '';
      mini.classList.toggle('is-paused', !playing);
      mini.setAttribute('aria-label', `${playing ? 'pausar' : 'tocar'} ${title}, de sunn`);
      const hide = () => {
        mini.classList.remove('is-on');
        miniTimer = setTimeout(() => { mini.hidden = true; }, 400);
      };
      if (playing && !visible) {
        mini.hidden = false;
        requestAnimationFrame(() => mini.classList.add('is-on'));
      } else if (!mini.hidden) {
        if (!visible) miniTimer = setTimeout(hide, 2200);
        else hide();
      }
    };
    if (mini) mini.addEventListener('click', () => { wake(); toggle(); });

    mark('menu');

    return {
      setVisible(on) {
        if (on === visible) return;
        visible = on;
        loop();
        syncMini();
      },
      pause
    };
  }

  const box = $('.ipod');
  if (box) window.iPod = create(box);
})();
