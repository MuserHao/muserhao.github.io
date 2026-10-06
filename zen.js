// ========== LIGHT THEME — ENSŌ ==========
// One sumi-e ensō in the homepage hero, brushed once per visit and only in
// the light theme. Bristles are short, overlapping dabs along an open circle
// whose pressure swells and then dries out.
(function () {
    const hero = document.querySelector('.hero-content');
    if (!hero) return;

    const wrap = document.createElement('div');
    wrap.className = 'zen-enso';
    wrap.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    hero.appendChild(wrap);
    const ctx = canvas.getContext('2d');

    const isLight = () => document.documentElement.getAttribute('data-theme') === 'light';
    let drawnAt = 0;

    function draw() {
        const size = canvas.clientWidth;
        if (!size || !isLight()) return;
        drawnAt = size;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = canvas.height = Math.round(size * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#1d1d1b';

        let seed = 7 + Math.floor(Math.random() * 100000);
        const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

        const cx = size / 2, cy = size / 2, R = size * 0.38;
        const start = -Math.PI * 0.62 + (rand() - 0.5) * 0.3;
        const sweep = Math.PI * 1.82;
        const bristles = 46, steps = 520;
        for (let b = 0; b < bristles; b++) {
            const off = b / (bristles - 1) - 0.5;
            const load = 0.55 + rand() * 0.45;      // ink carried by this bristle
            const wob = rand() * Math.PI * 2;
            for (let i = 0; i < steps; i++) {
                const t = i / steps;
                const pressure = Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * (1 - Math.pow(t, 3) * 0.85);
                // Dry brush: the chance a bristle skips rises smoothly from t = 0.3,
                // so ink thins out gradually instead of breaking off at one point.
                const dry = t < 0.3 ? 0 : Math.pow((t - 0.3) / 0.7, 1.3);
                if (rand() < dry * (1 - load * 0.12)) continue;
                const width = size * 0.075 * pressure;
                const a = start + sweep * t;
                const r = R + off * width + Math.sin(t * 9 + wob) * size * 0.003 + (rand() - 0.5) * size * 0.006;
                ctx.globalAlpha = 0.05 + 0.1 * load * pressure;
                ctx.beginPath();
                ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.max(0.35, size * 0.0035 * (0.6 + pressure)), 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }

    draw();
    new MutationObserver(() => { if (isLight()) draw(); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('resize', () => {
        if (Math.abs(canvas.clientWidth - drawnAt) > 24) draw();
    }, { passive: true });
})();
