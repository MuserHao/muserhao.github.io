(function () {
    'use strict';

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = document.getElementById('gen-art-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // ── Perlin gradient noise (classic 2D) ─────────────────────────────────────
    const PERM_SIZE = 256;
    const perm = new Uint8Array(PERM_SIZE * 2);
    (function seedPerm() {
        const arr = new Uint8Array(PERM_SIZE);
        for (let i = 0; i < PERM_SIZE; i++) arr[i] = i;
        for (let i = PERM_SIZE - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        for (let i = 0; i < PERM_SIZE * 2; i++) perm[i] = arr[i % PERM_SIZE];
    })();

    const GRAD2 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];

    function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function lerp(a, b, t) { return a + t * (b - a); }
    function dot2(g, x, y) { return g[0] * x + g[1] * y; }

    function noise2(x, y) {
        const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
        const xf = x - Math.floor(x), yf = y - Math.floor(y);
        const u = fade(xf), v = fade(yf);
        const aa = perm[perm[X]   + Y],     ab = perm[perm[X]   + Y + 1];
        const ba = perm[perm[X+1] + Y],     bb = perm[perm[X+1] + Y + 1];
        return lerp(
            lerp(dot2(GRAD2[aa&7], xf,   yf),   dot2(GRAD2[ba&7], xf-1, yf),   u),
            lerp(dot2(GRAD2[ab&7], xf,   yf-1), dot2(GRAD2[bb&7], xf-1, yf-1), u),
            v
        );
    }

    // ── Theme-aware palettes (restrained — fewer hues, lower alpha) ──────────
    const PALETTES = {
        dark: {
            trail:  'rgba(0, 0, 0, 0.05)',
            hues:   [185, 195, 320, 330],       // cyan-ish + pink-ish only
            sat:    '80%',
            lit:    '60%',
            alpha:  0.10,
        },
        light: {
            trail:  'rgba(250, 248, 245, 0.07)',
            hues:   [20, 25, 33, 210],
            sat:    '50%',
            lit:    '40%',
            alpha:  0.15,
        },
    };

    function getTheme() {
        return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    }

    let currentTheme = getTheme();

    // ── Canvas & resize ────────────────────────────────────────────────────────
    let W, H;
    function resize() {
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width  = W;
        canvas.height = H;
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    // ── Particles (reduced count for subtlety) ───────────────────────────────
    const NUM  = 500;
    const SPD  = 1.0;
    const SCALE = 0.003;

    function randHue() {
        const pal = PALETTES[currentTheme];
        return pal.hues[Math.floor(Math.random() * pal.hues.length)];
    }

    function randEdge() {
        const side = Math.floor(Math.random() * 4);
        if (side === 0) return { x: Math.random() * W, y: 0 };
        if (side === 1) return { x: W, y: Math.random() * H };
        if (side === 2) return { x: Math.random() * W, y: H };
        return { x: 0, y: Math.random() * H };
    }

    const particles = Array.from({ length: NUM }, () => ({
        x:   Math.random() * W,
        y:   Math.random() * H,
        hue: randHue(),
    }));

    // ── Theme switch ─────────────────────────────────────────────────────────
    new MutationObserver(() => {
        currentTheme = getTheme();
        particles.forEach(p => { p.hue = randHue(); });
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // ── Scroll-based fade: canvas fades out as user scrolls past hero ────────
    let canvasOpacity = 1;
    window.addEventListener('scroll', () => {
        const scrollY = window.pageYOffset;
        canvasOpacity = Math.max(0, 1 - scrollY / (H * 0.8));
        canvas.style.opacity = canvasOpacity;
    }, { passive: true });

    // ── Animation ─────────────────────────────────────────────────────────────
    let t = 0;
    let animId = null;

    function frame() {
        animId = requestAnimationFrame(frame);

        // Skip rendering when fully scrolled past hero
        if (canvasOpacity <= 0) return;

        t += 0.003;
        const pal = PALETTES[currentTheme];

        ctx.fillStyle = pal.trail;
        ctx.fillRect(0, 0, W, H);

        for (let i = 0; i < NUM; i++) {
            const p = particles[i];
            const vx = noise2(p.x * SCALE + t * 0.9,  p.y * SCALE + 47.3);
            const vy = noise2(p.x * SCALE + 91.7,     p.y * SCALE + t * 0.7);

            p.x += vx * SPD * 2;
            p.y += vy * SPD * 2;

            if (p.x < -5 || p.x > W + 5 || p.y < -5 || p.y > H + 5) {
                const e = randEdge();
                p.x = e.x;
                p.y = e.y;
                p.hue = randHue();
            }

            ctx.beginPath();
            ctx.arc(p.x, p.y, 1, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${p.hue}, ${pal.sat}, ${pal.lit}, ${pal.alpha})`;
            ctx.fill();
        }
    }

    function start() {
        frame();
        canvas.style.opacity = '1';
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (animId) { cancelAnimationFrame(animId); animId = null; }
        } else {
            if (!animId) frame();
        }
    });
})();
