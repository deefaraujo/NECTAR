// Profile effects (VFX) on canvas: particles covering the whole card, like Discord's profile effects.
// VFX.iniciar(canvas, tipo) starts it; the effect stops on its own when the canvas leaves the screen.
(() => {
  const R = (a, b) => a + Math.random() * (b - a);
  const reduzido = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // each type: how many particles, how they spawn and how they move/draw
  const TIPOS = {
    estrelas: {
      n: 46,
      nasce: (w, h) => ({ x: R(0, w), y: R(0, h), r: R(.4, 1.6), f: R(0, 6.28), v: R(.02, .06) }),
      passo(p, ctx, w, h, t) {
        p.f += p.v; const a = .35 + .65 * Math.abs(Math.sin(p.f));
        ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill();
        if (p.r > 1.3 && a > .9) { ctx.strokeStyle = `rgba(200,220,255,${a * .6})`; ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(p.x - 4, p.y); ctx.lineTo(p.x + 4, p.y); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x, p.y + 4); ctx.stroke(); }
      },
      extra(ctx, w, h, t, st) {      // shooting star every now and then
        if (!st.cad && Math.random() < .006) st.cad = { x: R(w * .3, w), y: R(0, h * .3), vida: 1 };
        const c = st.cad; if (!c) return;
        const g = ctx.createLinearGradient(c.x, c.y, c.x + 40, c.y - 20); g.addColorStop(0, `rgba(255,255,255,${c.vida})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + 40, c.y - 20); ctx.stroke();
        c.x -= 5; c.y += 2.5; c.vida -= .025; if (c.vida <= 0) st.cad = null;
      },
    },
    neve: {
      n: 60,
      nasce: (w, h, topo) => ({ x: R(0, w), y: topo ? R(-20, 0) : R(0, h), r: R(.8, 2.6), vy: R(.3, 1), f: R(0, 6.28) }),
      passo(p, ctx, w, h) { p.y += p.vy; p.f += .02; p.x += Math.sin(p.f) * .4; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); return p.y > h + 5; },
    },
    brasas: {
      n: 42,
      nasce: (w, h, topo) => ({ x: R(0, w), y: topo ? h + R(0, 20) : R(0, h), r: R(.8, 2.4), vy: R(.4, 1.3), f: R(0, 6.28), vida: R(.6, 1) }),
      passo(p, ctx, w, h) {
        p.y -= p.vy; p.f += .05; p.x += Math.sin(p.f) * .5; p.vida -= .003;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3); g.addColorStop(0, `rgba(255,230,140,${p.vida})`); g.addColorStop(.4, `rgba(255,120,20,${p.vida * .8})`); g.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3, 0, 6.28); ctx.fill(); return p.y < -10 || p.vida <= 0;
      },
    },
    petalas: {
      n: 26,
      nasce: (w, h, topo) => ({ x: R(0, w), y: topo ? R(-30, 0) : R(0, h), s: R(4, 8), vy: R(.4, 1.1), vx: R(-.3, .6), a: R(0, 6.28), va: R(-.04, .04), f: R(0, 6.28) }),
      passo(p, ctx, w, h) {
        p.y += p.vy; p.f += .03; p.x += p.vx + Math.sin(p.f) * .6; p.a += p.va;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.scale(1, .6 + .4 * Math.abs(Math.sin(p.f)));
        ctx.fillStyle = 'rgba(255,183,213,.9)'; ctx.beginPath(); ctx.moveTo(0, -p.s); ctx.quadraticCurveTo(p.s, 0, 0, p.s); ctx.quadraticCurveTo(-p.s, 0, 0, -p.s); ctx.fill();
        ctx.fillStyle = 'rgba(255,230,240,.7)'; ctx.fillRect(-.5, -p.s * .6, 1, p.s * 1.2); ctx.restore();
        return p.y > h + 10;
      },
    },
    bolhas: {
      n: 22,
      nasce: (w, h, topo) => ({ x: R(0, w), y: topo ? h + R(0, 30) : R(0, h), r: R(3, 11), vy: R(.3, .9), f: R(0, 6.28) }),
      passo(p, ctx, w, h) {
        p.y -= p.vy; p.f += .03; p.x += Math.sin(p.f) * .5;
        ctx.strokeStyle = 'rgba(180,235,255,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(p.x - p.r * .35, p.y - p.r * .35, p.r * .22, 0, 6.28); ctx.fill();
        return p.y < -p.r - 4;
      },
    },
    confete: {
      n: 50,
      nasce: (w, h, topo) => ({ x: R(0, w), y: topo ? R(-30, 0) : R(0, h), w: R(3, 6), h: R(5, 9), vy: R(.8, 2), vx: R(-.6, .6), a: R(0, 6.28), va: R(-.12, .12), c: ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff'][Math.floor(R(0, 5))] }),
      passo(p, ctx, w, h) {
        p.y += p.vy; p.x += p.vx; p.a += p.va;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.scale(Math.cos(p.a * 2), 1); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
        return p.y > h + 10;
      },
    },
    codigo: {
      n: 0,
      extra(ctx, w, h, t, st) {     // code rain
        const tam = 11; const cols = Math.ceil(w / tam);
        if (!st.y || st.y.length !== cols) st.y = Array.from({ length: cols }, () => R(-h, 0));
        ctx.font = `${tam}px monospace`;
        for (let i = 0; i < cols; i++) {
          const y = st.y[i];
          for (let k = 0; k < 8; k++) {
            const a = (1 - k / 8) * (k === 0 ? 1 : .55);
            ctx.fillStyle = k === 0 ? `rgba(220,255,230,${a})` : `rgba(0,255,140,${a})`;
            ctx.fillText(String.fromCharCode(0x30A0 + Math.floor(R(0, 96))), i * tam, y - k * tam);
          }
          st.y[i] += R(1.5, 3.2); if (st.y[i] - 8 * tam > h) st.y[i] = R(-60, 0);
        }
      },
    },
    vagalumes: {
      n: 18,
      nasce: (w, h) => ({ x: R(0, w), y: R(h * .3, h), vx: R(-.3, .3), vy: R(-.3, .3), f: R(0, 6.28), v: R(.02, .05) }),
      passo(p, ctx, w, h) {
        p.f += p.v; p.x += p.vx + Math.sin(p.f * 1.3) * .3; p.y += p.vy + Math.cos(p.f) * .3;
        if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > h) p.vy *= -1;
        const a = .3 + .7 * Math.max(0, Math.sin(p.f));
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 7); g.addColorStop(0, `rgba(240,255,150,${a})`); g.addColorStop(1, 'rgba(180,255,80,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 6.28); ctx.fill();
      },
    },
  };

  function iniciar(canvas, tipo) {
    const def = TIPOS[tipo];
    if (!canvas || !def) return () => {};
    if (canvas._vfxParar) canvas._vfxParar();
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0, h = 0, vivo = true, t = 0;
    const st = {};
    const medir = () => { w = canvas.clientWidth; h = canvas.clientHeight; canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    medir();
    const ps = Array.from({ length: def.n }, () => def.nasce(w, h, false));
    const quadro = () => {
      if (!vivo || !canvas.isConnected) return;
      if (canvas.clientWidth !== w || canvas.clientHeight !== h) medir();
      ctx.clearRect(0, 0, w, h); t++;
      for (let i = 0; i < ps.length; i++) if (def.passo(ps[i], ctx, w, h, t)) ps[i] = def.nasce(w, h, true);
      def.extra?.(ctx, w, h, t, st);
      requestAnimationFrame(quadro);
    };
    if (reduzido()) { quadro(); vivo = false; }   // reduced motion: a single still frame
    else requestAnimationFrame(quadro);
    canvas._vfxParar = () => { vivo = false; };
    return canvas._vfxParar;
  }

  /** Turns on the effects of all not-yet-started [data-vfx] canvases inside `raiz`. */
  function ligar(raiz = document) {
    raiz.querySelectorAll('canvas[data-vfx]').forEach((c) => { if (c.dataset.vfxOn !== c.dataset.vfx) { c.dataset.vfxOn = c.dataset.vfx; iniciar(c, c.dataset.vfx); } });
  }

  window.VFX = { iniciar, ligar, tipos: Object.keys(TIPOS) };
})();
