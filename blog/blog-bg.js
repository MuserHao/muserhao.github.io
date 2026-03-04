(function () {
    'use strict';

    // Reader-friendly: deliberately slower, fewer particles, longer trails
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // ── Canvas ─────────────────────────────────────────────────────────────────
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;opacity:0;transition:opacity 3s ease;';
    document.body.insertBefore(canvas, document.body.firstChild);
    const ctx = canvas.getContext('2d');

    // ── Perlin noise ───────────────────────────────────────────────────────────
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
    function fade(t) { return t*t*t*(t*(t*6-15)+10); }
    function lerp(a, b, t) { return a + t * (b - a); }
    function dot2(g, x, y) { return g[0]*x + g[1]*y; }
    function noise2(x, y) {
        const X = Math.floor(x)&255, Y = Math.floor(y)&255;
        const xf = x-Math.floor(x), yf = y-Math.floor(y);
        const u = fade(xf), v = fade(yf);
        const aa=perm[perm[X]+Y], ab=perm[perm[X]+Y+1], ba=perm[perm[X+1]+Y], bb=perm[perm[X+1]+Y+1];
        return lerp(lerp(dot2(GRAD2[aa&7],xf,yf),dot2(GRAD2[ba&7],xf-1,yf),u),
                    lerp(dot2(GRAD2[ab&7],xf,yf-1),dot2(GRAD2[bb&7],xf-1,yf-1),u),v);
    }

    // ── Palettes ───────────────────────────────────────────────────────────────
    //
    // Dark:  deep slate/indigo wisps — present but recede behind text.
    //        Hues 210–240 (cool midnight blue) at very low sat/brightness.
    //        Long trails (alpha 0.015) create ink-wash streaks, not hard lines.
    //
    // Light: warm sand/parchment wisps — hues 30–200 (fawn, warm grey, dusty teal)
    //        at high lightness (~78%), so they're whisper-faint on the cream bg.
    //        Feels like aged paper grain rather than harsh fluorescent particles.

    const PALETTES = {
        dark: {
            trail: 'rgba(8, 8, 18, 0.015)',
            hues:  [200, 215, 230, 245, 255],
            sat:   '35%',
            lit:   '28%',
            alpha: 0.07,
        },
        light: {
            trail: 'rgba(250, 248, 245, 0.018)',
            hues:  [30, 35, 40, 195, 210],
            sat:   '28%',
            lit:   '62%',
            alpha: 0.10,
        },
    };

    function getTheme() {
        return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    }
    let currentTheme = getTheme();

    // ── Canvas resize ──────────────────────────────────────────────────────────
    let W, H;
    function resize() {
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width  = W;
        canvas.height = H;
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    // ── Particles ─────────────────────────────────────────────────────────────
    // Intentionally sparse — 80 particles vs 1500 on main page.
    // The long trail alpha (~0.015) means each stroke lingers for ~4 seconds,
    // building up soft layered ink-wash textures rather than dense particle noise.
    const NUM   = 80;
    const SPD   = 0.55;    // slow drift
    const SCALE = 0.002;   // broad noise scale → large, sweeping arcs

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
        x: Math.random() * W,
        y: Math.random() * H,
        hue: randHue(),
    }));

    new MutationObserver(() => {
        currentTheme = getTheme();
        particles.forEach(p => { p.hue = randHue(); });
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // ── Animation ─────────────────────────────────────────────────────────────
    let t = 0;
    let animId = null;

    function frame() {
        animId = requestAnimationFrame(frame);
        t += 0.002;   // even slower time advance than main page

        const pal = PALETTES[currentTheme];
        ctx.fillStyle = pal.trail;
        ctx.fillRect(0, 0, W, H);

        for (let i = 0; i < NUM; i++) {
            const p = particles[i];
            // Independent vx / vy from separate noise regions (no directional bias)
            const vx = noise2(p.x * SCALE + t * 0.8,  p.y * SCALE + 53.1);
            const vy = noise2(p.x * SCALE + 97.4,     p.y * SCALE + t * 0.6);
            p.x += vx * SPD * 2;
            p.y += vy * SPD * 2;

            if (p.x < -5 || p.x > W + 5 || p.y < -5 || p.y > H + 5) {
                const e = randEdge();
                p.x = e.x; p.y = e.y;
                p.hue = randHue();
            }

            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
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
