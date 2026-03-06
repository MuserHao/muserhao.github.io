// ========== STARFIELD + MILKY WAY + METEORS ==========
// Canvas-based space background for Fun Lab pages. Always dark.

(function initStarfield() {
    'use strict';

    // Force dark theme on lab pages — space is dark
    document.documentElement.setAttribute('data-theme', 'dark');

    // Disable theme toggle so visitors can't switch to light
    var toggle = document.querySelector('.theme-toggle');
    if (toggle) toggle.style.display = 'none';

    var canvas = document.createElement('canvas');
    canvas.id = 'starfield';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);

    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var stars = [];
    var meteors = [];
    var STAR_COUNT = 500;
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function resize() {
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
    }

    // ---- Stars ----
    function generateStars() {
        stars = [];
        var w = canvas.width, h = canvas.height;
        for (var i = 0; i < STAR_COUNT; i++) {
            stars.push({
                x: Math.random() * w,
                y: Math.random() * h,
                r: Math.random() * 1.8 + 0.2,
                baseAlpha: Math.random() * 0.7 + 0.15,
                twinkleSpeed: Math.random() * 2.5 + 0.3,
                twinklePhase: Math.random() * Math.PI * 2,
                hue: Math.random() < 0.6 ? 0 : (Math.random() < 0.5 ? 200 + Math.random() * 40 : 25 + Math.random() * 25),
                sat: Math.random() < 0.6 ? 0 : Math.random() * 60 + 20
            });
        }
    }

    // ---- Meteors: spawn from any edge, any direction ----
    function spawnMeteor() {
        var w = canvas.width, h = canvas.height;
        var edge = Math.floor(Math.random() * 4); // 0=top, 1=right, 2=bottom, 3=left
        var x, y, angle;

        switch (edge) {
            case 0: // top edge — fly downward
                x = Math.random() * w;
                y = -10;
                angle = Math.PI / 2 + (Math.random() - 0.5) * 1.2; // roughly downward
                break;
            case 1: // right edge — fly leftward
                x = w + 10;
                y = Math.random() * h;
                angle = Math.PI + (Math.random() - 0.5) * 1.2;
                break;
            case 2: // bottom edge — fly upward
                x = Math.random() * w;
                y = h + 10;
                angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
                break;
            case 3: // left edge — fly rightward
                x = -10;
                y = Math.random() * h;
                angle = (Math.random() - 0.5) * 1.2;
                break;
        }

        var speed = 5 + Math.random() * 8;
        var size = Math.random();

        meteors.push({
            x: x * dpr,
            y: y * dpr,
            vx: Math.cos(angle) * speed * dpr,
            vy: Math.sin(angle) * speed * dpr,
            life: 1.0,
            decay: 0.008 + Math.random() * 0.015,
            tailLen: 50 + Math.random() * 80,
            width: (size < 0.7 ? 1 : (size < 0.9 ? 2 : 3)) * dpr,
            // Color: most white-blue, rare warm/green ones
            r: size < 0.85 ? 200 : (size < 0.95 ? 255 : 100),
            g: size < 0.85 ? 230 : (size < 0.95 ? 200 : 255),
            b: 255
        });
    }

    function maybeSpawnMeteor() {
        if (reducedMotion) return;
        // ~1% chance per frame = roughly 1 meteor per 1.5 seconds at 60fps
        if (Math.random() < 0.01) spawnMeteor();
    }

    // ---- Milky Way band ----
    function drawMilkyWay(w, h) {
        // Inner bright band
        ctx.save();
        ctx.globalAlpha = 0.06;
        var grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(0.3, 'rgba(180, 160, 255, 0.4)');
        grad.addColorStop(0.45, 'rgba(100, 200, 255, 0.6)');
        grad.addColorStop(0.5, 'rgba(200, 180, 255, 0.7)');
        grad.addColorStop(0.55, 'rgba(100, 200, 255, 0.6)');
        grad.addColorStop(0.7, 'rgba(180, 160, 255, 0.4)');
        grad.addColorStop(1, 'transparent');
        ctx.translate(w / 2, h / 2);
        ctx.rotate(-0.5);
        ctx.fillStyle = grad;
        ctx.fillRect(-w, -h * 0.12, w * 2, h * 0.24);
        ctx.restore();

        // Outer soft band
        ctx.save();
        ctx.globalAlpha = 0.03;
        ctx.translate(w / 2, h / 2);
        ctx.rotate(-0.5);
        var grad2 = ctx.createLinearGradient(-w, 0, w, 0);
        grad2.addColorStop(0, 'transparent');
        grad2.addColorStop(0.25, 'rgba(140, 120, 220, 0.3)');
        grad2.addColorStop(0.5, 'rgba(160, 200, 255, 0.5)');
        grad2.addColorStop(0.75, 'rgba(140, 120, 220, 0.3)');
        grad2.addColorStop(1, 'transparent');
        ctx.fillStyle = grad2;
        ctx.fillRect(-w, -h * 0.25, w * 2, h * 0.5);
        ctx.restore();
    }

    // ---- Main draw ----
    function draw(t) {
        var w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        drawMilkyWay(w, h);

        // Stars
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

            // Glow on bright stars
            if (s.r > 1.3 && alpha > 0.4 && !reducedMotion) {
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r * dpr * 3, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(200,220,255,' + (alpha * 0.15) + ')';
                ctx.fill();
            }
        }

        // Meteors
        for (var j = meteors.length - 1; j >= 0; j--) {
            var m = meteors[j];
            m.x += m.vx;
            m.y += m.vy;
            m.life -= m.decay;

            if (m.life <= 0) {
                meteors.splice(j, 1);
                continue;
            }

            // Tail: line from current position back along velocity
            var tailScale = m.tailLen / Math.sqrt(m.vx * m.vx + m.vy * m.vy);
            var tailX = m.x - m.vx * tailScale;
            var tailY = m.y - m.vy * tailScale;

            ctx.save();
            ctx.globalAlpha = m.life * 0.85;

            // Gradient tail
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

            // Bright head glow
            if (m.width > 1.5 * dpr) {
                ctx.beginPath();
                ctx.arc(m.x, m.y, m.width * 2, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(' + m.r + ',' + m.g + ',' + m.b + ',' + (m.life * 0.3) + ')';
                ctx.fill();
            }

            ctx.restore();
        }

        maybeSpawnMeteor();
    }

    // ---- Loop ----
    function loop(t) {
        t *= 0.001;
        draw(t);
        requestAnimationFrame(loop);
    }

    function init() {
        resize();
        generateStars();
        requestAnimationFrame(loop);
    }

    window.addEventListener('resize', function () {
        resize();
        generateStars();
    });

    init();
})();
