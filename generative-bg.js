(function () {
    'use strict';

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const canvas = document.getElementById('gen-art-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // ── Dark: one sample from a diffusion model ─────────────────────────────
    // Every particle starts as Gaussian noise and is carried along the straight
    // noise-to-data path x_t = (1 - t)·x0 + t·z (rectified flow) until the cloud
    // settles into an open ring: order out of noise. The loop then just breathes.
    const DARK = {
        bg:    'rgba(8, 10, 16, 0.22)',
        hues:  [190, 195, 205, 215, 340],
        num:   1500,
        steps: 1000,           // shown as the timestep counter
        dur:   9000,           // ms from pure noise to the sample
    };

    function getTheme() {
        return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    }
    let currentTheme = getTheme();

    // ── Canvas & resize ──────────────────────────────────────────────────────
    let W, H;
    function resize() {
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width  = W;
        canvas.height = H;
    }
    resize();

    function gauss() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    // Data distribution: a ring with a brushed width and one open gap (an ensō,
    // the same mark the light theme draws in ink).
    const GAP = -Math.PI * 0.32, GAP_W = 0.42;
    function sampleData() {
        let a;
        do { a = Math.random() * Math.PI * 2; }
        while (Math.abs(Math.atan2(Math.sin(a - GAP), Math.cos(a - GAP))) < GAP_W * Math.random() + 0.08);
        const from = ((a - GAP - GAP_W) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
        const width = 0.012 + 0.05 * Math.sin(Math.min(1, from * 1.4) * Math.PI * 0.5) * (1 - from * 0.7);
        return { a, dr: gauss() * width };
    }

    let particles = [];
    function seed() {
        particles = Array.from({ length: DARK.num }, () => {
            const d = sampleData();
            const h = DARK.hues[Math.random() < 0.12 ? 4 : Math.floor(Math.random() * 4)];
            return { a: d.a, dr: d.dr, zx: gauss(), zy: gauss(), spin: (Math.random() - 0.5) * 0.00004,
                     hue: h, lit: 55 + Math.random() * 20, size: 0.6 + Math.random() * 0.9 };
        });
    }
    seed();

    function geometry() {
        const hero = document.querySelector('.hero-content h1');
        const r = hero && hero.getBoundingClientRect();
        const cy = r && r.height ? r.top + r.height / 2 + H * 0.08 : H * 0.42;
        return { cx: W / 2, cy, R: Math.min(W * 0.42, H * 0.36), S: Math.max(W, H) * 0.42 };
    }
    let G = geometry();
    window.addEventListener('resize', () => { resize(); G = geometry(); }, { passive: true });

    // Timestep counter in the hero, dark only.
    const counter = document.getElementById('diffusion-t');
    let t0 = null;
    function restart() {
        t0 = null; seed(); ctx.clearRect(0, 0, W, H);
        if (still && currentTheme === 'dark') for (let i = 0; i < 12; i++) frameDark(performance.now());
    }
    if (counter) counter.addEventListener('click', restart);

    // ── Theme switch ─────────────────────────────────────────────────────────
    new MutationObserver(() => {
        currentTheme = getTheme();
        ctx.clearRect(0, 0, W, H);
        if (currentTheme === 'light') { lightPainted = false; paintLight(); }
        else restart();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const ease = (x) => 1 - Math.pow(1 - x, 3);

    function frameDark(now) {
        if (t0 === null) t0 = now;
        const p = still ? 1 : Math.min(1, (now - t0) / DARK.dur);
        const t = 1 - ease(p);                    // 1 = pure noise, 0 = sample
        const { cx, cy, R, S } = G;
        const breathe = now * 0.001;

        // Motion trails while sampling; a clean clear once the sample has
        // settled, so no faint streaks are left behind.
        if (p < 1) { ctx.fillStyle = DARK.bg; ctx.fillRect(0, 0, W, H); }
        else ctx.clearRect(0, 0, W, H);

        for (let i = 0; i < particles.length; i++) {
            const q = particles[i];
            q.a += q.spin * (1 - t) * 16;
            const r = R * (1 + q.dr + 0.004 * Math.sin(breathe + q.a * 3));
            const x0 = cx + Math.cos(q.a) * r, y0 = cy + Math.sin(q.a) * r;
            const x = (1 - t) * x0 + t * (cx + q.zx * S);
            const y = (1 - t) * y0 + t * (cy + q.zy * S);
            ctx.fillStyle = `hsla(${q.hue},60%,${q.lit}%,${0.35 + 0.45 * (1 - t)})`;
            ctx.fillRect(x, y, q.size, q.size);
        }

        if (counter) {
            const step = Math.round(t * DARK.steps);
            counter.textContent = step > 0 ? `sampling · t = ${String(step).padStart(4, '0')}` : 'sampled · t = 0000 · resample';
        }
    }

    // Fade the field once the reader scrolls past the hero.
    function onScroll() {
        if (currentTheme !== 'dark') return;
        canvas.style.opacity = String(Math.max(0.12, 1 - window.scrollY / (H * 0.9)));
    }
    window.addEventListener('scroll', onScroll, { passive: true });

    // ── Light: plain washi ─────────────────────────────────────────────────
    // The light theme draws a single ensō instead (zen.js); keep the canvas clear.
    let lightPainted = false;

    function paintLight() {
        if (lightPainted) return;
        lightPainted = true;
        ctx.clearRect(0, 0, W, H);
    }

    // ── Main loop ────────────────────────────────────────────────────────────
    let animId = null;
    function frame(now) {
        animId = requestAnimationFrame(frame);
        if (currentTheme === 'dark') frameDark(now);
    }

    function start() {
        G = geometry();
        if (currentTheme === 'light') paintLight();
        canvas.style.opacity = '1';
        canvas.style.display = 'block';
        if (still) {
            // Reduced motion: draw the finished sample once, no animation.
            for (let i = 0; i < 12; i++) frameDark(performance.now());
            return;
        }
        animId = requestAnimationFrame(frame);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    document.addEventListener('visibilitychange', () => {
        if (still) return;
        if (document.hidden) {
            if (animId) { cancelAnimationFrame(animId); animId = null; }
        } else if (!animId) {
            animId = requestAnimationFrame(frame);
        }
    });
})();
