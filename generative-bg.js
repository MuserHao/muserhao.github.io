(function () {
    'use strict';

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = document.getElementById('gen-art-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // ── Perlin noise ─────────────────────────────────────────────────────────
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
        const aa = perm[perm[X] + Y],   ab = perm[perm[X] + Y + 1];
        const ba = perm[perm[X+1] + Y], bb = perm[perm[X+1] + Y + 1];
        return lerp(
            lerp(dot2(GRAD2[aa&7], xf, yf),     dot2(GRAD2[ba&7], xf-1, yf),   u),
            lerp(dot2(GRAD2[ab&7], xf, yf-1),   dot2(GRAD2[bb&7], xf-1, yf-1), u),
            v
        );
    }

    // ── Palettes ─────────────────────────────────────────────────────────────
    const DARK = {
        trail:     'rgba(10, 12, 20, 0.04)',
        hues:      [195, 205, 215, 340],
        sats:      [50,  50,  50,  40],
        lits:      [62,  62,  62,  58],
        dotAlpha:  0.5,
        lineAlpha: 0.15,
        linkDist:  150,
        num:       200,
        speed:     0.8,
        scale:     0.0025,
    };

    const LIGHT = {
        hues:  [14, 25, 42, 355, 220, 200, 140],
        sats:  [52, 55, 48, 45,  42,  38,  32],
        lits:  [45, 48, 55, 42,  46,  52,  48],
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
    window.addEventListener('resize', () => {
        resize();
        // Repaint light theme on resize
        if (currentTheme === 'light') { lightPainted = false; paintLight(); }
    }, { passive: true });

    // ── Particles (dark theme only) ──────────────────────────────────────────
    function randHue(pal) {
        const idx = Math.floor(Math.random() * pal.hues.length);
        return { h: pal.hues[idx], s: pal.sats[idx], l: pal.lits[idx] };
    }

    function randEdge() {
        const side = Math.floor(Math.random() * 4);
        if (side === 0) return { x: Math.random() * W, y: 0 };
        if (side === 1) return { x: W, y: Math.random() * H };
        if (side === 2) return { x: Math.random() * W, y: H };
        return { x: 0, y: Math.random() * H };
    }

    const darkParticles = Array.from({ length: DARK.num }, () => {
        const x = Math.random() * W, y = Math.random() * H;
        const c = randHue(DARK);
        return { x, y, px: x, py: y, hue: c.h, sat: c.s, lit: c.l };
    });

    // ── Theme switch ─────────────────────────────────────────────────────────
    new MutationObserver(() => {
        currentTheme = getTheme();
        ctx.clearRect(0, 0, W, H);
        if (currentTheme === 'light') { lightPainted = false; paintLight(); }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // ── Spatial grid (dark mode) ─────────────────────────────────────────────
    let grid = {};
    const CELL = 130;
    function buildGrid(pts) {
        grid = {};
        for (let i = 0; i < pts.length; i++) {
            const key = Math.floor(pts[i].x / CELL) + ',' + Math.floor(pts[i].y / CELL);
            if (!grid[key]) grid[key] = [];
            grid[key].push(i);
        }
    }
    function getNeighborCells(cx, cy) {
        const result = [];
        for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++) {
                const cell = grid[(cx + dx) + ',' + (cy + dy)];
                if (cell) result.push(cell);
            }
        return result;
    }

    // ── Dark: constellation mesh (continuous animation) ──────────────────────
    let t = 0;
    let animId = null;

    function frameDark() {
        const pal = DARK;
        const pts = darkParticles;

        ctx.fillStyle = pal.trail;
        ctx.fillRect(0, 0, W, H);

        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            p.px = p.x; p.py = p.y;
            const vx = noise2(p.x * pal.scale + t * 0.8, p.y * pal.scale + 47.3);
            const vy = noise2(p.x * pal.scale + 91.7,    p.y * pal.scale + t * 0.6);
            p.x += vx * pal.speed * 2;
            p.y += vy * pal.speed * 2;
            if (p.x < -10 || p.x > W+10 || p.y < -10 || p.y > H+10) {
                const e = randEdge(); p.x = e.x; p.y = e.y; p.px = p.x; p.py = p.y;
                const c = randHue(pal); p.hue = c.h; p.sat = c.s; p.lit = c.l;
            }
        }

        buildGrid(pts);
        const ld = pal.linkDist, ld2 = ld * ld;
        ctx.lineWidth = 0.5;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const neighbors = getNeighborCells(Math.floor(p.x/CELL), Math.floor(p.y/CELL));
            for (const cell of neighbors) {
                for (const j of cell) {
                    if (j <= i) continue;
                    const q = pts[j];
                    const dx = p.x-q.x, dy = p.y-q.y, d2 = dx*dx+dy*dy;
                    if (d2 < ld2) {
                        const alpha = pal.lineAlpha * (1 - Math.sqrt(d2)/ld);
                        ctx.strokeStyle = `hsla(${p.hue},${p.sat}%,${p.lit}%,${alpha})`;
                        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
                    }
                }
            }
        }
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            ctx.beginPath(); ctx.arc(p.x, p.y, 1.2, 0, Math.PI*2);
            ctx.fillStyle = `hsla(${p.hue},${p.sat}%,${p.lit}%,${pal.dotAlpha})`;
            ctx.fill();
        }
    }

    // ── Light: plain washi ─────────────────────────────────────────────────
    // The light theme draws a single ensō instead (zen.js); keep the canvas clear.
    let lightPainted = false;

    function paintLight() {
        if (lightPainted) return;
        lightPainted = true;
        ctx.clearRect(0, 0, W, H);
    }

    // ── Main loop ────────────────────────────────────────────────────────────
    function frame() {
        animId = requestAnimationFrame(frame);
        t += 0.002;

        if (currentTheme === 'dark') {
            frameDark();
        }
        // Light mode: painting is static, no per-frame work needed
    }

    function start() {
        if (currentTheme === 'light') {
            paintLight();
        }
        frame();
        // Force canvas visible
        canvas.style.opacity = '1';
        canvas.style.display = 'block';
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
