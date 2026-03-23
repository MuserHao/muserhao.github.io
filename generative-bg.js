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
        trail:     'rgba(245, 240, 232, 0.005)',  // very slow → colors linger much longer
        hues:      [14, 25, 42, 355, 220, 200, 140],
        sats:      [52, 55, 48, 45,  42,  38,  32],
        lits:      [45, 48, 55, 42,  46,  52,  48],
        num:       80,
        speed:     0.2,                             // very slow — contemplative, unhurried
        scale:     0.001,                            // large noise → sweeping gentle arcs
        baseAlpha: 0.15,          // bold strokes — colors clearly distinguishable
        maxWidth:  6,
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
    window.addEventListener('resize', resize, { passive: true });

    // ── Particles — separate pools per theme ─────────────────────────────────
    function randHue(pal) {
        const idx = Math.floor(Math.random() * pal.hues.length);
        return {
            h: pal.hues[idx],
            s: pal.sats ? pal.sats[idx] : parseInt(pal.sat),
            l: pal.lits ? pal.lits[idx] : parseInt(pal.lit),
        };
    }

    function randEdge() {
        const side = Math.floor(Math.random() * 4);
        if (side === 0) return { x: Math.random() * W, y: 0 };
        if (side === 1) return { x: W, y: Math.random() * H };
        if (side === 2) return { x: Math.random() * W, y: H };
        return { x: 0, y: Math.random() * H };
    }

    function createParticles(pal) {
        return Array.from({ length: pal.num }, () => {
            const x = Math.random() * W;
            const y = Math.random() * H;
            const c = randHue(pal);
            return {
                x, y,
                px: x, py: y,
                ppx: x, ppy: y,
                hue: c.h, sat: c.s, lit: c.l,
                life: Math.random(),
            };
        });
    }

    let darkParticles = createParticles(DARK);
    let lightParticles = createParticles(LIGHT);

    // ── Theme switch ─────────────────────────────────────────────────────────
    new MutationObserver(() => {
        currentTheme = getTheme();
        const pal = currentTheme === 'dark' ? DARK : LIGHT;
        (currentTheme === 'dark' ? darkParticles : lightParticles).forEach(p => {
            const c = randHue(pal); p.hue = c.h; p.sat = c.s; p.lit = c.l;
        });
        ctx.clearRect(0, 0, W, H);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // ── Canvas always visible — both themes are full-page ─────────────────────
    let canvasOpacity = 1;

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

    // ── Animation ────────────────────────────────────────────────────────────
    let t = 0;
    let animId = null;

    function frame() {
        animId = requestAnimationFrame(frame);
        t += 0.002;

        if (currentTheme === 'dark') {
            frameDark();
        } else {
            frameLight();
        }
    }

    // ── Dark: constellation mesh ─────────────────────────────────────────────
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

    // ── Light: ink wash / watercolor ─────────────────────────────────────────
    function frameLight() {
        const pal = LIGHT;
        const pts = lightParticles;

        ctx.fillStyle = pal.trail;
        ctx.fillRect(0, 0, W, H);

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];

            // Save two-step history for bezier control points
            p.ppx = p.px; p.ppy = p.py;
            p.px = p.x;   p.py = p.y;

            // Use very slow noise at different scales for organic flow
            const n1 = noise2(p.x * pal.scale + t * 0.25, p.y * pal.scale + 47.3 + i * 0.1);
            const n2 = noise2(p.x * pal.scale + 91.7,    p.y * pal.scale + t * 0.15 + i * 0.1);

            p.x += n1 * pal.speed * 2;
            p.y += n2 * pal.speed * 2;

            if (p.x < -20 || p.x > W+20 || p.y < -20 || p.y > H+20) {
                const e = randEdge();
                p.x = e.x; p.y = e.y;
                p.px = p.x; p.py = p.y;
                p.ppx = p.x; p.ppy = p.y;
                const c = randHue(pal);
                p.hue = c.h; p.sat = c.s; p.lit = c.l;
                p.life = Math.random();
                continue;
            }

            const dx = p.x - p.px;
            const dy = p.y - p.py;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < 0.2) continue;

            const cpx = p.px + (p.px - p.ppx) * 0.3;
            const cpy = p.py + (p.py - p.ppy) * 0.3;

            const width = pal.maxWidth * Math.max(0.4, Math.min(1.0, 0.8 / (dist + 0.3)));
            ctx.lineWidth = width;

            const alpha = pal.baseAlpha * (0.6 + 0.4 * Math.sin(p.life * 6.28 + t * 2));
            ctx.strokeStyle = `hsla(${p.hue}, ${p.sat}%, ${p.lit}%, ${alpha})`;

            ctx.beginPath();
            ctx.moveTo(p.ppx, p.ppy);
            ctx.quadraticCurveTo(cpx, cpy, p.x, p.y);
            ctx.stroke();

            // Occasional "bloom"
            if (Math.random() < 0.008) {
                const r = 12 + Math.random() * 30;
                const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
                grad.addColorStop(0, `hsla(${p.hue}, ${p.sat}%, ${p.lit}%, 0.08)`);
                grad.addColorStop(0.5, `hsla(${p.hue}, ${p.sat}%, ${p.lit}%, 0.03)`);
                grad.addColorStop(1, `hsla(${p.hue}, ${p.sat}%, ${p.lit}%, 0)`);
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.fill();
            }
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
