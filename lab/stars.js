// ========== STARFIELD + MILKY WAY ==========
// Canvas-based starfield with twinkling and a nebula band for Fun Lab pages.

(function initStarfield() {
    'use strict';

    var canvas = document.createElement('canvas');
    canvas.id = 'starfield';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);

    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var stars = [];
    var shootingStars = [];
    var STAR_COUNT = 400;
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function resize() {
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
    }

    function isDark() {
        return document.documentElement.getAttribute('data-theme') !== 'light';
    }

    // Generate star field
    function generateStars() {
        stars = [];
        var w = canvas.width, h = canvas.height;
        for (var i = 0; i < STAR_COUNT; i++) {
            stars.push({
                x: Math.random() * w,
                y: Math.random() * h,
                r: Math.random() * 1.5 + 0.3,           // radius 0.3-1.8
                baseAlpha: Math.random() * 0.6 + 0.2,    // 0.2-0.8
                twinkleSpeed: Math.random() * 2 + 0.5,   // different speeds
                twinklePhase: Math.random() * Math.PI * 2,
                // Color: mostly white, some blue/cyan/warm tint
                hue: Math.random() < 0.7 ? 0 : (Math.random() < 0.5 ? 200 + Math.random() * 40 : 30 + Math.random() * 20),
                sat: Math.random() < 0.7 ? 0 : Math.random() * 50 + 30
            });
        }
    }

    // Occasional shooting star
    function maybeSpawnShootingStar() {
        if (reducedMotion) return;
        if (Math.random() > 0.003) return; // ~0.3% chance per frame
        var w = canvas.width, h = canvas.height;
        shootingStars.push({
            x: Math.random() * w * 0.8,
            y: Math.random() * h * 0.4,
            vx: 4 + Math.random() * 6,
            vy: 2 + Math.random() * 3,
            life: 1.0,
            decay: 0.015 + Math.random() * 0.02,
            len: 40 + Math.random() * 60
        });
    }

    // Draw milky way band (diagonal nebula)
    function drawMilkyWay(w, h) {
        ctx.save();
        ctx.globalAlpha = isDark() ? 0.06 : 0.03;

        // Diagonal gradient band from top-left to bottom-right
        var grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(0.3, 'rgba(180, 160, 255, 0.4)');
        grad.addColorStop(0.45, 'rgba(100, 200, 255, 0.6)');
        grad.addColorStop(0.5, 'rgba(200, 180, 255, 0.7)');
        grad.addColorStop(0.55, 'rgba(100, 200, 255, 0.6)');
        grad.addColorStop(0.7, 'rgba(180, 160, 255, 0.4)');
        grad.addColorStop(1, 'transparent');

        // Rotated wide band
        ctx.translate(w / 2, h / 2);
        ctx.rotate(-0.5); // ~30 degrees
        ctx.fillStyle = grad;
        ctx.fillRect(-w, -h * 0.12, w * 2, h * 0.24);
        ctx.restore();

        // Second, softer, wider band
        ctx.save();
        ctx.globalAlpha = isDark() ? 0.03 : 0.015;
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

    function draw(t) {
        var w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        var dark = isDark();

        // Milky way
        drawMilkyWay(w, h);

        // Stars
        for (var i = 0; i < stars.length; i++) {
            var s = stars[i];
            var twinkle = reducedMotion ? 1 : (0.5 + 0.5 * Math.sin(t * s.twinkleSpeed + s.twinklePhase));
            var alpha = s.baseAlpha * twinkle * (dark ? 1 : 0.3);
            if (alpha < 0.02) continue;

            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r * dpr, 0, Math.PI * 2);

            if (s.sat > 0) {
                ctx.fillStyle = 'hsla(' + s.hue + ',' + s.sat + '%,80%,' + alpha + ')';
            } else {
                ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
            }
            ctx.fill();

            // Bright stars get a glow
            if (s.r > 1.2 && alpha > 0.4 && !reducedMotion) {
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r * dpr * 3, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(200,220,255,' + (alpha * 0.15) + ')';
                ctx.fill();
            }
        }

        // Shooting stars
        for (var j = shootingStars.length - 1; j >= 0; j--) {
            var ss = shootingStars[j];
            ss.x += ss.vx * dpr;
            ss.y += ss.vy * dpr;
            ss.life -= ss.decay;

            if (ss.life <= 0) {
                shootingStars.splice(j, 1);
                continue;
            }

            ctx.save();
            ctx.globalAlpha = ss.life * (dark ? 0.8 : 0.3);
            var tailX = ss.x - ss.vx * dpr * (ss.len / 6);
            var tailY = ss.y - ss.vy * dpr * (ss.len / 6);
            var grad = ctx.createLinearGradient(tailX, tailY, ss.x, ss.y);
            grad.addColorStop(0, 'transparent');
            grad.addColorStop(1, 'rgba(200, 230, 255, 1)');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.5 * dpr;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(ss.x, ss.y);
            ctx.stroke();
            ctx.restore();
        }

        maybeSpawnShootingStar();
    }

    // Animation loop
    var rafId;
    function loop(t) {
        t *= 0.001; // convert to seconds
        draw(t);
        rafId = requestAnimationFrame(loop);
    }

    function init() {
        resize();
        generateStars();
        rafId = requestAnimationFrame(loop);
    }

    window.addEventListener('resize', function () {
        resize();
        generateStars();
    });

    init();
})();
