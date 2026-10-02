// ========== LAB INDEX PREVIEWS ==========
// Tiny looping vignettes for the exhibit list: a lander settling onto a pad,
// a pong rally. Scripted motion only (no RL). Each canvas animates only while
// on screen, and draws a single still frame under prefers-reduced-motion.

(function () {
    'use strict';

    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var BG = '#05060d';
    var CYAN = '#8ff6ff', VIOLET = '#9d8cff', PINK = '#ff8ad8', GOLD = '#ffe3a3', INK = '#eef1ff';

    function setup(canvas) {
        var ctx = canvas.getContext('2d');
        var w = 0, h = 0;
        function resize() {
            var r = canvas.getBoundingClientRect();
            var dpr = Math.min(window.devicePixelRatio || 1, 2);
            w = r.width; h = r.height;
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        resize();
        return { ctx: ctx, size: function () { return [w, h]; }, resize: resize };
    }

    // Deterministic pseudo-random so the stills look the same every load
    function rng(seed) {
        return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    }

    function starfield(n, seed) {
        var r = rng(seed), s = [];
        for (var i = 0; i < n; i++) s.push({ x: r(), y: r(), a: 0.15 + r() * 0.5, z: 0.4 + r() * 0.9 });
        return s;
    }

    function drawStars(ctx, stars, w, h, maxY) {
        ctx.fillStyle = INK;
        for (var i = 0; i < stars.length; i++) {
            var s = stars[i];
            if (s.y > maxY) continue;
            ctx.globalAlpha = s.a;
            ctx.fillRect(s.x * w, s.y * h, s.z, s.z);
        }
        ctx.globalAlpha = 1;
    }

    // ---------------- Lander vignette ----------------
    function lander(canvas) {
        var g = setup(canvas), ctx = g.ctx;
        var stars = starfield(60, 7);
        var r = rng(11), ridge = [];
        for (var i = 0; i <= 24; i++) ridge.push(r());
        var flames = [];
        var PERIOD = 6.5; // seconds per descent

        function terrainY(x, w, h) {
            // x in px -> ground height; pad is flat around 62% width
            var u = x / w, padC = 0.62, padHalf = 0.09;
            var base = h * 0.78;
            if (Math.abs(u - padC) < padHalf) return base;
            var f = u * 24, k = Math.floor(f), t = f - k;
            var n = ridge[k] * (1 - t) + ridge[Math.min(k + 1, 24)] * t;
            var falloff = Math.min(1, (Math.abs(u - padC) - padHalf) * 6);
            return base - (n * h * 0.22 + Math.sin(u * 9) * h * 0.04) * falloff;
        }

        function frame(time) {
            var wh = g.size(), w = wh[0], h = wh[1];
            if (!w) return;
            var t = (time / 1000) % PERIOD;
            var p = Math.min(1, t / (PERIOD - 1.6)); // descent progress; holds at 1 for the last 1.6s
            var ease = 1 - Math.pow(1 - p, 2.2);

            ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
            var sky = ctx.createLinearGradient(0, 0, 0, h);
            sky.addColorStop(0, 'rgba(157,140,255,0.0)');
            sky.addColorStop(0.75, 'rgba(157,140,255,0.07)');
            sky.addColorStop(1, 'rgba(143,246,255,0.02)');
            ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
            drawStars(ctx, stars, w, h, 0.7);

            // terrain
            var padX = w * 0.62, padY = h * 0.78, padW = w * 0.16;
            ctx.beginPath(); ctx.moveTo(0, h);
            for (var x = 0; x <= w; x += 6) ctx.lineTo(x, terrainY(x, w, h));
            ctx.lineTo(w, h); ctx.closePath();
            var tg = ctx.createLinearGradient(0, h * 0.55, 0, h);
            tg.addColorStop(0, '#12142a'); tg.addColorStop(1, BG);
            ctx.fillStyle = tg; ctx.fill();
            // contour lines
            for (var c = 1; c <= 3; c++) {
                ctx.beginPath();
                for (var x2 = 0; x2 <= w; x2 += 8) {
                    var y2 = terrainY(x2, w, h) + c * 9;
                    if (x2 === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2);
                }
                ctx.strokeStyle = 'rgba(157,140,255,' + (0.16 - c * 0.04) + ')';
                ctx.lineWidth = 1; ctx.stroke();
            }
            // ridge line
            ctx.beginPath();
            for (var x3 = 0; x3 <= w; x3 += 6) { var y3 = terrainY(x3, w, h); if (x3 === 0) ctx.moveTo(x3, y3); else ctx.lineTo(x3, y3); }
            var rg = ctx.createLinearGradient(0, 0, w, 0);
            rg.addColorStop(0, 'rgba(143,246,255,0.35)'); rg.addColorStop(0.5, 'rgba(157,140,255,0.5)'); rg.addColorStop(1, 'rgba(255,138,216,0.35)');
            ctx.strokeStyle = rg; ctx.lineWidth = 1.2; ctx.stroke();

            // pad glow + pad
            var glow = ctx.createRadialGradient(padX, padY, 0, padX, padY, padW * 0.9);
            glow.addColorStop(0, 'rgba(143,246,255,0.28)'); glow.addColorStop(1, 'rgba(143,246,255,0)');
            ctx.fillStyle = glow; ctx.fillRect(padX - padW, padY - padW * 0.9, padW * 2, padW * 1.8);
            ctx.fillStyle = CYAN; ctx.fillRect(padX - padW / 2, padY - 1.5, padW, 3);
            var blink = reduced ? 1 : (Math.sin(time / 250) > 0 ? 1 : 0.35);
            ctx.globalAlpha = blink; ctx.fillStyle = GOLD;
            ctx.fillRect(padX - padW / 2, padY - 5, 2, 2); ctx.fillRect(padX + padW / 2 - 2, padY - 5, 2, 2);
            ctx.globalAlpha = 1;

            // lander
            var scale = Math.max(0.7, Math.min(1.3, h / 200));
            var LH = 22 * scale, LW = 18 * scale, legH = 6 * scale, legSpan = 15 * scale;
            var restY = padY - LH / 2 - legH;
            var startY = -LH;
            var ly = startY + (restY - startY) * ease;
            var lx = padX - w * 0.22 * (1 - ease) + Math.sin(t * 2.1) * 4 * (1 - ease);
            var ang = (1 - ease) * 0.35 * Math.sin(t * 1.3 + 0.6);
            var thrusting = p < 1 && p > 0.15;

            if (thrusting && !reduced) {
                for (var k2 = 0; k2 < 2; k2++) flames.push({
                    x: lx - Math.sin(ang) * LH * 0.5, y: ly + Math.cos(ang) * LH * 0.5,
                    vx: (Math.random() - 0.5) * 0.6 - Math.sin(ang) * 1.6, vy: 1.4 + Math.random() * 1.2, life: 1
                });
            }
            for (var f = flames.length - 1; f >= 0; f--) {
                var fl = flames[f];
                fl.x += fl.vx; fl.y += fl.vy; fl.life -= 0.06;
                if (fl.y > terrainY(fl.x, w, h)) { fl.vy *= -0.3; fl.vx *= 2; }
                if (fl.life <= 0) { flames.splice(f, 1); continue; }
                ctx.globalAlpha = fl.life * 0.8;
                ctx.fillStyle = fl.life > 0.55 ? GOLD : PINK;
                var sz = 1 + fl.life * 2.2;
                ctx.fillRect(fl.x - sz / 2, fl.y - sz / 2, sz, sz);
            }
            ctx.globalAlpha = 1;

            ctx.save();
            ctx.translate(lx, ly); ctx.rotate(ang);
            if (thrusting) {
                var fl2 = LH * (0.5 + (reduced ? 0.3 : Math.random() * 0.5));
                var fg = ctx.createLinearGradient(0, LH / 2, 0, LH / 2 + fl2);
                fg.addColorStop(0, 'rgba(255,255,255,0.95)'); fg.addColorStop(0.35, 'rgba(255,227,163,0.85)'); fg.addColorStop(1, 'rgba(255,138,216,0)');
                ctx.fillStyle = fg;
                ctx.beginPath(); ctx.moveTo(-4 * scale, LH / 2); ctx.lineTo(4 * scale, LH / 2); ctx.lineTo(0, LH / 2 + fl2); ctx.closePath(); ctx.fill();
            }
            drawLanderBody(ctx, LW, LH, legSpan, legH);
            ctx.restore();
        }
        return { frame: frame, resize: g.resize };
    }

    function drawLanderBody(ctx, LW, LH, legSpan, legH) {
        var film = ctx.createLinearGradient(-LW / 2, -LH / 2, LW / 2, LH / 2);
        film.addColorStop(0, CYAN); film.addColorStop(0.4, VIOLET); film.addColorStop(0.7, PINK); film.addColorStop(1, GOLD);
        ctx.strokeStyle = '#aab2d4'; ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-LW / 2 + 2, LH / 2); ctx.lineTo(-legSpan, LH / 2 + legH);
        ctx.moveTo(LW / 2 - 2, LH / 2); ctx.lineTo(legSpan, LH / 2 + legH);
        ctx.moveTo(-legSpan - 3, LH / 2 + legH); ctx.lineTo(-legSpan + 3, LH / 2 + legH);
        ctx.moveTo(legSpan - 3, LH / 2 + legH); ctx.lineTo(legSpan + 3, LH / 2 + legH);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -LH / 2); ctx.lineTo(-LW / 2, LH / 2); ctx.lineTo(LW / 2, LH / 2); ctx.closePath();
        ctx.fillStyle = '#0d0f22'; ctx.fill();
        ctx.strokeStyle = film; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.beginPath(); ctx.arc(0, LH * 0.08, LW * 0.13, 0, Math.PI * 2);
        ctx.fillStyle = CYAN; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
    }

    // ---------------- Pong vignette ----------------
    function pong(canvas) {
        var g = setup(canvas), ctx = g.ctx;
        var stars = starfield(36, 3);
        var trail = [];
        var ball = { x: 0.5, y: 0.5, vx: 0.0065, vy: 0.0043 };
        var lp = 0.5, rp = 0.5, last = 0;

        function frame(time) {
            var wh = g.size(), w = wh[0], h = wh[1];
            if (!w) return;
            var dt = last ? Math.min(3, (time - last) / 16.67) : 1; last = time;
            var padH = 0.2, padX = 0.06;

            if (!reduced) {
                ball.x += ball.vx * dt; ball.y += ball.vy * dt;
                if (ball.y < 0.04 || ball.y > 0.96) { ball.vy *= -1; ball.y = Math.max(0.04, Math.min(0.96, ball.y)); }
                if (ball.x < padX + 0.02 && ball.vx < 0) { ball.vx *= -1; ball.vy = (ball.y - lp) * 0.05 + (Math.random() - 0.5) * 0.004; }
                if (ball.x > 1 - padX - 0.02 && ball.vx > 0) { ball.vx *= -1; ball.vy = (ball.y - rp) * 0.05 + (Math.random() - 0.5) * 0.004; }
                if (Math.abs(ball.vy) < 0.002) ball.vy = 0.003 * (ball.vy < 0 ? -1 : 1);
                // paddles track with lag, never quite perfectly
                lp += (ball.y + Math.sin(time / 700) * 0.05 - lp) * (ball.vx < 0 ? 0.12 : 0.03) * dt;
                rp += (ball.y + Math.cos(time / 600) * 0.05 - rp) * (ball.vx > 0 ? 0.12 : 0.03) * dt;
                trail.push({ x: ball.x, y: ball.y }); if (trail.length > 10) trail.shift();
            }

            ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
            drawStars(ctx, stars, w, h, 1);
            // net: dotted hairline
            ctx.fillStyle = 'rgba(170,178,212,0.22)';
            for (var y = 6; y < h; y += 10) ctx.fillRect(w / 2 - 0.5, y, 1, 4);
            // score
            ctx.fillStyle = 'rgba(238,241,255,0.12)';
            ctx.font = '300 ' + Math.round(h * 0.16) + 'px Unbounded, "Space Grotesk", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('7', w * 0.3, h * 0.24); ctx.fillText('6', w * 0.7, h * 0.24);

            var ph = h * padH, pw = Math.max(3, w * 0.012);
            paddle(ctx, w * padX - pw, lp * h - ph / 2, pw, ph, CYAN, VIOLET);
            paddle(ctx, w * (1 - padX), rp * h - ph / 2, pw, ph, PINK, GOLD);

            var br = Math.max(3, h * 0.022);
            for (var i = 0; i < trail.length; i++) {
                var a = (i + 1) / trail.length;
                ctx.globalAlpha = a * 0.35;
                ctx.fillStyle = i < trail.length / 2 ? VIOLET : CYAN;
                ctx.beginPath(); ctx.arc(trail[i].x * w, trail[i].y * h, br * (0.4 + a * 0.6), 0, Math.PI * 2); ctx.fill();
            }
            ctx.globalAlpha = 0.18; ctx.fillStyle = CYAN;
            ctx.beginPath(); ctx.arc(ball.x * w, ball.y * h, br * 2.6, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1; ctx.fillStyle = INK;
            ctx.beginPath(); ctx.arc(ball.x * w, ball.y * h, br, 0, Math.PI * 2); ctx.fill();
        }
        return { frame: frame, resize: g.resize };
    }

    function paddle(ctx, x, y, pw, ph, c1, c2) {
        var gr = ctx.createLinearGradient(0, y, 0, y + ph);
        gr.addColorStop(0, c1); gr.addColorStop(1, c2);
        ctx.fillStyle = gr;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, pw, ph, pw / 2); else ctx.rect(x, y, pw, ph);
        ctx.fill();
    }

    // ---------------- Wiring ----------------
    var makers = { lander: lander, pong: pong };
    var items = [];
    document.querySelectorAll('canvas[data-preview]').forEach(function (cv) {
        var make = makers[cv.getAttribute('data-preview')];
        if (!make) return;
        items.push({ canvas: cv, scene: make(cv), visible: true });
    });
    if (!items.length) return;

    // first frame immediately, so offscreen previews are never blank
    items.forEach(function (it) { it.scene.frame(reduced ? 4200 : 1); });
    if (reduced) {
        window.addEventListener('resize', function () { items.forEach(function (it) { it.scene.resize(); it.scene.frame(4200); }); });
        return;
    }

    if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                items.forEach(function (it) { if (it.canvas === e.target) it.visible = e.isIntersecting; });
            });
        });
        items.forEach(function (it) { io.observe(it.canvas); });
    }
    // resizing clears a canvas; repaint at once so offscreen previews keep a frame
    window.addEventListener('resize', function () { items.forEach(function (it) { it.scene.resize(); it.scene.frame(performance.now()); }); });

    function loop(t) {
        if (!document.hidden) items.forEach(function (it) { if (it.visible) it.scene.frame(t); });
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
})();
