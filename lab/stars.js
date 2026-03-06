// ========== SPACE BACKGROUND: STARS, MILKY WAY, METEORS, BLACK HOLES ==========
// Full canvas space scene for Fun Lab pages. Always dark.

(function initSpace() {
    'use strict';

    // Force dark theme — space is dark
    document.documentElement.setAttribute('data-theme', 'dark');
    var toggle = document.querySelector('.theme-toggle');
    if (toggle) toggle.style.display = 'none';

    // Kill the colored particle system (from shared.js)
    var particleContainer = document.getElementById('particles');
    if (particleContainer) particleContainer.style.display = 'none';

    var canvas = document.createElement('canvas');
    canvas.id = 'starfield';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);

    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var W, H;
    var stars = [];
    var meteors = [];
    var blackHoles = [];
    var STAR_COUNT = 1200;
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Box-Muller: Gaussian random (mean=0, std=1)
    function randn() {
        var u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    function resize() {
        W = window.innerWidth * dpr;
        H = window.innerHeight * dpr;
        canvas.width = W;
        canvas.height = H;
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
    }

    // ================================================================
    // STARS — Gaussian density falloff from milky way center line
    // ================================================================
    function generateStars() {
        stars = [];
        // Milky way diagonal: angle ≈ -0.5 rad (~30°)
        var bandAngle = -0.5;
        var cosA = Math.cos(bandAngle), sinA = Math.sin(bandAngle);
        // Screen diagonal length for scaling
        var diag = Math.sqrt(W * W + H * H);

        for (var i = 0; i < STAR_COUNT; i++) {
            // 65% of stars drawn from the Gaussian milky way distribution
            var inBand = Math.random() < 0.65;
            var x, y;

            if (inBand) {
                // Uniform position along the band axis
                var along = (Math.random() - 0.5) * 1.5;
                // Gaussian perpendicular offset — σ = 0.10 of diagonal
                // This gives smooth density: dense core → gradual thinning
                var perp = randn() * 0.10;

                // Convert band-local coords to screen coords
                x = W / 2 + along * diag * cosA - perp * diag * sinA;
                y = H / 2 + along * diag * sinA + perp * diag * cosA;
            } else {
                x = Math.random() * W;
                y = Math.random() * H;
            }

            var depth = Math.random();
            // Band stars: smaller and slightly dimmer (dense distant cluster look)
            var bandScale = inBand ? 0.65 : 1.0;
            stars.push({
                x: x,
                y: y,
                r: depth * 1.6 * bandScale + 0.2,
                baseAlpha: depth * 0.6 * bandScale + 0.12,
                twinkleSpeed: Math.random() * 3 + 0.3,
                twinklePhase: Math.random() * Math.PI * 2,
                hue: Math.random() < 0.5 ? 0 : (Math.random() < 0.6 ? 210 + Math.random() * 30 : 20 + Math.random() * 30),
                sat: Math.random() < 0.5 ? 0 : Math.random() * 60 + 20
            });
        }
    }

    // ================================================================
    // MILKY WAY — layered nebula bands
    // ================================================================
    function drawMilkyWay() {
        ctx.save();

        // Dense star dust — many tiny dots along the band
        ctx.globalAlpha = 0.08;
        var grad1 = ctx.createLinearGradient(0, 0, W, H);
        grad1.addColorStop(0, 'transparent');
        grad1.addColorStop(0.25, 'rgba(140, 130, 200, 0.3)');
        grad1.addColorStop(0.4, 'rgba(100, 180, 255, 0.5)');
        grad1.addColorStop(0.5, 'rgba(180, 160, 240, 0.6)');
        grad1.addColorStop(0.6, 'rgba(100, 180, 255, 0.5)');
        grad1.addColorStop(0.75, 'rgba(140, 130, 200, 0.3)');
        grad1.addColorStop(1, 'transparent');
        ctx.translate(W / 2, H / 2);
        ctx.rotate(-0.5);
        ctx.fillStyle = grad1;
        ctx.fillRect(-W, -H * 0.1, W * 2, H * 0.2);
        ctx.restore();

        // Wider soft glow
        ctx.save();
        ctx.globalAlpha = 0.04;
        ctx.translate(W / 2, H / 2);
        ctx.rotate(-0.5);
        var grad2 = ctx.createLinearGradient(-W, 0, W, 0);
        grad2.addColorStop(0, 'transparent');
        grad2.addColorStop(0.2, 'rgba(120, 100, 200, 0.2)');
        grad2.addColorStop(0.5, 'rgba(150, 180, 255, 0.4)');
        grad2.addColorStop(0.8, 'rgba(120, 100, 200, 0.2)');
        grad2.addColorStop(1, 'transparent');
        ctx.fillStyle = grad2;
        ctx.fillRect(-W, -H * 0.3, W * 2, H * 0.6);
        ctx.restore();

        // Warm dust lane through center
        ctx.save();
        ctx.globalAlpha = 0.025;
        ctx.translate(W / 2, H / 2);
        ctx.rotate(-0.5);
        var grad3 = ctx.createLinearGradient(-W, 0, W, 0);
        grad3.addColorStop(0, 'transparent');
        grad3.addColorStop(0.35, 'rgba(200, 150, 100, 0.3)');
        grad3.addColorStop(0.5, 'rgba(180, 120, 80, 0.4)');
        grad3.addColorStop(0.65, 'rgba(200, 150, 100, 0.3)');
        grad3.addColorStop(1, 'transparent');
        ctx.fillStyle = grad3;
        ctx.fillRect(-W, -H * 0.04, W * 2, H * 0.08);
        ctx.restore();
    }

    // ================================================================
    // BLACK HOLES — spinning accretion disk + gravitational distortion
    // ================================================================
    function generateBlackHoles() {
        blackHoles = [];
        // 1-2 black holes at random positions
        var count = 1 + Math.floor(Math.random() * 2);
        for (var i = 0; i < count; i++) {
            blackHoles.push({
                x: W * (0.15 + Math.random() * 0.7),
                y: H * (0.15 + Math.random() * 0.7),
                coreR: (20 + Math.random() * 25) * dpr,
                diskR: (60 + Math.random() * 50) * dpr,
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (0.3 + Math.random() * 0.4) * (Math.random() < 0.5 ? 1 : -1),
                tilt: 0.3 + Math.random() * 0.4, // perspective squash
                pulsePhase: Math.random() * Math.PI * 2
            });
        }
    }

    function drawBlackHoles(t) {
        for (var i = 0; i < blackHoles.length; i++) {
            var bh = blackHoles[i];
            bh.rotation += bh.rotSpeed * 0.016; // ~per frame at 60fps

            var cx = bh.x, cy = bh.y;
            var pulse = 1 + 0.08 * Math.sin(t * 1.5 + bh.pulsePhase);

            // Gravitational lensing ring (outer glow)
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(cx, cy, bh.diskR * 1.4 * pulse, bh.diskR * 1.4 * bh.tilt * pulse, bh.rotation * 0.1, 0, Math.PI * 2);
            var lensGrad = ctx.createRadialGradient(cx, cy, bh.diskR * 0.8, cx, cy, bh.diskR * 1.5);
            lensGrad.addColorStop(0, 'rgba(100, 150, 255, 0.08)');
            lensGrad.addColorStop(0.5, 'rgba(150, 120, 255, 0.04)');
            lensGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = lensGrad;
            ctx.fill();
            ctx.restore();

            // Accretion disk — multiple spinning rings
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(bh.rotation * 0.1);
            ctx.scale(1, bh.tilt);

            for (var ring = 3; ring >= 0; ring--) {
                var ringR = bh.diskR * (0.6 + ring * 0.15) * pulse;
                var ringW = bh.diskR * 0.06;
                ctx.beginPath();
                ctx.ellipse(0, 0, ringR, ringR, bh.rotation + ring * 0.5, 0, Math.PI * 2);
                ctx.lineWidth = ringW;

                // Color shifts per ring: orange -> blue -> purple
                var colors = [
                    'rgba(255, 140, 50, 0.4)',
                    'rgba(200, 100, 255, 0.35)',
                    'rgba(100, 160, 255, 0.3)',
                    'rgba(180, 80, 200, 0.25)'
                ];
                ctx.strokeStyle = colors[ring];
                ctx.stroke();
            }

            // Hot inner ring — brightest
            ctx.beginPath();
            ctx.ellipse(0, 0, bh.coreR * 1.5 * pulse, bh.coreR * 1.5 * pulse, bh.rotation, 0, Math.PI * 2);
            ctx.lineWidth = bh.coreR * 0.2;
            var hotGrad = ctx.createLinearGradient(-bh.coreR * 2, 0, bh.coreR * 2, 0);
            hotGrad.addColorStop(0, 'rgba(255, 200, 100, 0.5)');
            hotGrad.addColorStop(0.5, 'rgba(255, 255, 200, 0.6)');
            hotGrad.addColorStop(1, 'rgba(255, 150, 50, 0.5)');
            ctx.strokeStyle = hotGrad;
            ctx.stroke();

            ctx.restore();

            // Black core — true black circle with dark gradient
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(1, bh.tilt);
            ctx.beginPath();
            ctx.arc(0, 0, bh.coreR, 0, Math.PI * 2);
            var coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, bh.coreR);
            coreGrad.addColorStop(0, 'rgba(0, 0, 0, 1)');
            coreGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0.95)');
            coreGrad.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
            ctx.fillStyle = coreGrad;
            ctx.fill();
            ctx.restore();

            // Photon ring — thin bright line at the event horizon
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(1, bh.tilt);
            ctx.beginPath();
            ctx.arc(0, 0, bh.coreR * 1.05, 0, Math.PI * 2);
            ctx.lineWidth = 1.5 * dpr;
            ctx.strokeStyle = 'rgba(255, 220, 150, ' + (0.3 + 0.15 * Math.sin(t * 2 + bh.pulsePhase)) + ')';
            ctx.stroke();
            ctx.restore();
        }
    }

    // ================================================================
    // METEORS — multi-directional streaks
    // ================================================================
    function spawnMeteor() {
        var edge = Math.floor(Math.random() * 4);
        var x, y, angle;
        switch (edge) {
            case 0: x = Math.random() * W; y = -10; angle = Math.PI / 2 + (Math.random() - 0.5) * 1.2; break;
            case 1: x = W + 10; y = Math.random() * H; angle = Math.PI + (Math.random() - 0.5) * 1.2; break;
            case 2: x = Math.random() * W; y = H + 10; angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2; break;
            case 3: x = -10; y = Math.random() * H; angle = (Math.random() - 0.5) * 1.2; break;
        }

        var speed = 5 + Math.random() * 8;
        var size = Math.random();
        meteors.push({
            x: x, y: y,
            vx: Math.cos(angle) * speed * dpr,
            vy: Math.sin(angle) * speed * dpr,
            life: 1.0,
            decay: 0.008 + Math.random() * 0.015,
            tailLen: 50 + Math.random() * 80,
            width: (size < 0.7 ? 1 : (size < 0.9 ? 2 : 3)) * dpr,
            r: size < 0.85 ? 200 : (size < 0.95 ? 255 : 100),
            g: size < 0.85 ? 230 : (size < 0.95 ? 200 : 255),
            b: 255
        });
    }

    // ================================================================
    // MAIN DRAW
    // ================================================================
    function draw(t) {
        ctx.clearRect(0, 0, W, H);

        // Layer 1: Milky way nebula
        drawMilkyWay();

        // Layer 2: Stars
        for (var i = 0; i < stars.length; i++) {
            var s = stars[i];
            var twinkle = reducedMotion ? 1 : (0.5 + 0.5 * Math.sin(t * s.twinkleSpeed + s.twinklePhase));
            var alpha = s.baseAlpha * twinkle;
            if (alpha < 0.02) continue;

            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r * dpr, 0, Math.PI * 2);
            if (s.sat > 0) {
                ctx.fillStyle = 'hsla(' + s.hue + ',' + s.sat + '%,80%,' + alpha + ')';
            } else {
                ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
            }
            ctx.fill();

            // Glow halo on bright stars
            if (s.r > 1.3 && alpha > 0.4 && !reducedMotion) {
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r * dpr * 3, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(200,220,255,' + (alpha * 0.12) + ')';
                ctx.fill();
            }
        }

        // Layer 3: Black holes
        if (!reducedMotion) drawBlackHoles(t);

        // Layer 4: Meteors
        for (var j = meteors.length - 1; j >= 0; j--) {
            var m = meteors[j];
            m.x += m.vx;
            m.y += m.vy;
            m.life -= m.decay;

            if (m.life <= 0) { meteors.splice(j, 1); continue; }

            var tailScale = m.tailLen / Math.sqrt(m.vx * m.vx + m.vy * m.vy);
            var tailX = m.x - m.vx * tailScale;
            var tailY = m.y - m.vy * tailScale;

            ctx.save();
            ctx.globalAlpha = m.life * 0.85;
            var grad = ctx.createLinearGradient(tailX, tailY, m.x, m.y);
            grad.addColorStop(0, 'transparent');
            grad.addColorStop(0.6, 'rgba(' + m.r + ',' + m.g + ',' + m.b + ',0.3)');
            grad.addColorStop(1, 'rgba(' + m.r + ',' + m.g + ',' + m.b + ',1)');
            ctx.strokeStyle = grad;
            ctx.lineWidth = m.width;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(m.x, m.y);
            ctx.stroke();

            if (m.width > 1.5 * dpr) {
                ctx.beginPath();
                ctx.arc(m.x, m.y, m.width * 2, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(' + m.r + ',' + m.g + ',' + m.b + ',' + (m.life * 0.3) + ')';
                ctx.fill();
            }
            ctx.restore();
        }

        // Spawn meteors — ~1 every 0.5 seconds at 60fps
        if (!reducedMotion && Math.random() < 0.035) spawnMeteor();
    }

    // ---- Loop ----
    function loop(t) {
        draw(t * 0.001);
        requestAnimationFrame(loop);
    }

    function init() {
        resize();
        generateStars();
        generateBlackHoles();
        requestAnimationFrame(loop);
    }

    window.addEventListener('resize', function () {
        resize();
        generateStars();
        generateBlackHoles();
    });

    init();
})();
