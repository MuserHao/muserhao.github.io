// ========== LUNAR LANDER ENGINE ==========
// Fixed 800×600 logical coordinate space. CSS scales the canvas.
// Physics: gravity, thrust, rotation, wind, terrain, collision.

const LanderEngine = (function () {
    'use strict';

    const W = 800, H = 600;

    // Physics constants
    const GRAVITY = 0.04;
    const THRUST_MAIN = 0.15;
    const THRUST_SIDE = 0.05;
    const ROTATE_SPEED = 0.04;
    const ANGULAR_DAMPING = 0.98;
    const MAX_STEPS = 500;

    // Lander geometry
    const LANDER_W = 28, LANDER_H = 32;
    const LEG_SPAN = 22, LEG_H = 8;

    // Landing pad
    const PAD_W = 80;

    // Reduced motion check
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 6 discrete actions
    const ACTIONS = { NOOP: 0, THRUST_MAIN: 1, THRUST_LEFT: 2, THRUST_RIGHT: 3, ROTATE_LEFT: 4, ROTATE_RIGHT: 5 };

    function create(canvas) {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        function resize() {
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
        }
        resize();
        window.addEventListener('resize', resize);

        // Terrain generation — midpoint displacement
        let terrain = [];
        let padLeft = 0, padRight = 0, padY = 0;

        function generateTerrain() {
            const nPoints = 33; // power of 2 + 1
            const pts = new Float64Array(nPoints);
            pts[0] = H * 0.7 + Math.random() * 40;
            pts[nPoints - 1] = H * 0.7 + Math.random() * 40;

            // Midpoint displacement
            for (let step = nPoints - 1; step >= 2; step = Math.floor(step / 2)) {
                const half = Math.floor(step / 2);
                const roughness = step * 1.5;
                for (let i = half; i < nPoints - 1; i += step) {
                    const avg = (pts[i - half] + pts[i + half]) / 2;
                    pts[i] = avg + (Math.random() - 0.5) * roughness;
                }
            }

            // Clamp terrain heights
            for (let i = 0; i < nPoints; i++) {
                pts[i] = Math.max(H * 0.5, Math.min(H * 0.88, pts[i]));
            }

            // Place landing pad — pick a random segment in middle third
            const padIdx = 10 + Math.floor(Math.random() * 12);
            const segW = W / (nPoints - 1);
            padLeft = padIdx * segW - PAD_W / 2;
            padRight = padLeft + PAD_W;
            padY = pts[padIdx];

            // Flatten pad region
            const padIdxStart = Math.max(0, Math.floor(padLeft / segW));
            const padIdxEnd = Math.min(nPoints - 1, Math.ceil(padRight / segW));
            for (let i = padIdxStart; i <= padIdxEnd; i++) {
                pts[i] = padY;
            }

            // Build polyline
            terrain = [];
            for (let i = 0; i < nPoints; i++) {
                terrain.push({ x: i * segW, y: pts[i] });
            }
        }

        // State
        let lander = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0 };
        let leftContact = 0, rightContact = 0;
        let stepCount = 0;
        let thrustMain = false, thrustLeft = false, thrustRight = false;
        let running = false;
        let windEnabled = false;
        let windForce = 0;

        // Flame particles
        let flames = [];

        // Callbacks
        let onStepDone = null;
        let onEpisodeEnd = null;

        // Spawn lander
        function spawnLander(level) {
            // level 0=easy (directly above pad, very low), 1-3 increasingly harder
            const padCx = (padLeft + padRight) / 2;

            if (level === 0) {
                // Easy: right above the pad, low altitude, no velocity
                // Agent just needs to brake a short fall
                lander.x = padCx + (Math.random() - 0.5) * 15;
                lander.y = padY - 35 - Math.random() * 25;
                lander.vx = 0;
                lander.vy = Math.random() * 0.3;
                lander.angle = 0;
            } else if (level === 1) {
                // Medium: moderate altitude, small offset
                lander.x = padCx + (Math.random() - 0.5) * 80;
                lander.y = padY - 100 - Math.random() * 80;
                lander.vx = (Math.random() - 0.5) * 0.5;
                lander.vy = Math.random() * 0.5;
                lander.angle = (Math.random() - 0.5) * 0.1;
            } else if (level === 2) {
                // Hard: high altitude, large offset
                lander.x = padCx + (Math.random() - 0.5) * 200;
                lander.y = padY - 160 - Math.random() * 140;
                lander.vx = (Math.random() - 0.5) * 1.0;
                lander.vy = Math.random() * 0.5;
                lander.angle = (Math.random() - 0.5) * 0.2;
            } else {
                // Full: everything + wind
                lander.x = padCx + (Math.random() - 0.5) * 300;
                lander.y = padY - 200 - Math.random() * 200;
                lander.vx = (Math.random() - 0.5) * 1.5;
                lander.vy = Math.random() * 1.0;
                lander.angle = (Math.random() - 0.5) * 0.3;
            }

            lander.angVel = 0;
            leftContact = 0;
            rightContact = 0;
            stepCount = 0;
            thrustMain = false;
            thrustLeft = false;
            thrustRight = false;
            windForce = 0;
            flames = [];
        }

        // Get terrain height at x via linear interpolation
        function terrainHeightAt(x) {
            if (terrain.length < 2) return H;
            if (x <= terrain[0].x) return terrain[0].y;
            if (x >= terrain[terrain.length - 1].x) return terrain[terrain.length - 1].y;
            for (let i = 0; i < terrain.length - 1; i++) {
                if (x >= terrain[i].x && x <= terrain[i + 1].x) {
                    const t = (x - terrain[i].x) / (terrain[i + 1].x - terrain[i].x);
                    return terrain[i].y + t * (terrain[i + 1].y - terrain[i].y);
                }
            }
            return H;
        }

        // Get lander bottom corners (leg tips) in world space
        function getLegTips() {
            const cosA = Math.cos(lander.angle);
            const sinA = Math.sin(lander.angle);
            const halfSpan = LEG_SPAN;
            const legDy = LANDER_H / 2 + LEG_H;
            return {
                left:  { x: lander.x + (-halfSpan) * cosA - legDy * sinA,
                         y: lander.y + (-halfSpan) * sinA + legDy * cosA },
                right: { x: lander.x + halfSpan * cosA - legDy * sinA,
                         y: lander.y + halfSpan * sinA + legDy * cosA }
            };
        }

        // Check landing criteria
        function checkLanding() {
            const tips = getLegTips();

            // Check if legs are touching or near the pad surface (within 8px)
            const legsTouchingGround = tips.left.y >= padY - 8 && tips.right.y >= padY - 8;

            const onPad = legsTouchingGround &&
                          tips.left.x >= padLeft && tips.left.x <= padRight &&
                          tips.right.x >= padLeft && tips.right.x <= padRight;
            const upright = Math.abs(lander.angle) < (20 * Math.PI / 180);
            const slow = Math.abs(lander.vy) < 1.5 && Math.abs(lander.vx) < 0.8;

            if (onPad && upright && slow) {
                leftContact = 1;
                rightContact = 1;
                return 'landed';
            }

            // Check crash — any leg tip below terrain
            const lTerrain = terrainHeightAt(tips.left.x);
            const rTerrain = terrainHeightAt(tips.right.x);
            if (tips.left.y >= lTerrain || tips.right.y >= rTerrain) {
                return 'crash';
            }

            // Check body touching terrain (lander center near ground)
            const bodyBottom = lander.y + LANDER_H / 2;
            const centerTerrain = terrainHeightAt(lander.x);
            if (bodyBottom >= centerTerrain) {
                return 'crash';
            }

            return null;
        }

        // Physics step
        function applyAction(action) {
            thrustMain = false;
            thrustLeft = false;
            thrustRight = false;

            switch (action) {
                case ACTIONS.THRUST_MAIN:
                    thrustMain = true;
                    break;
                case ACTIONS.THRUST_LEFT:
                    thrustLeft = true;
                    break;
                case ACTIONS.THRUST_RIGHT:
                    thrustRight = true;
                    break;
                case ACTIONS.ROTATE_LEFT:
                    lander.angVel -= ROTATE_SPEED;
                    break;
                case ACTIONS.ROTATE_RIGHT:
                    lander.angVel += ROTATE_SPEED;
                    break;
            }

            // Main thrust — along lander's up axis
            if (thrustMain) {
                lander.vx += -Math.sin(lander.angle) * THRUST_MAIN;
                lander.vy += -Math.cos(lander.angle) * THRUST_MAIN;
            }

            // Side thrusters
            if (thrustLeft) {
                lander.vx -= Math.cos(lander.angle) * THRUST_SIDE;
                lander.vy -= Math.sin(lander.angle) * THRUST_SIDE;
            }
            if (thrustRight) {
                lander.vx += Math.cos(lander.angle) * THRUST_SIDE;
                lander.vy += Math.sin(lander.angle) * THRUST_SIDE;
            }
        }

        function step(action) {
            if (action !== undefined) applyAction(action);
            else applyAction(currentAction);

            // Gravity
            lander.vy += GRAVITY;

            // Wind
            if (windEnabled) {
                if (Math.random() < 0.02) {
                    windForce = (Math.random() - 0.5) * 0.04;
                }
                lander.vx += windForce;
            }

            // Angular damping
            lander.angVel *= ANGULAR_DAMPING;

            // Integrate
            lander.x += lander.vx;
            lander.y += lander.vy;
            lander.angle += lander.angVel;

            stepCount++;

            // Check boundaries
            let result = null;
            let reward = 0;

            if (lander.x < -20 || lander.x > W + 20 || lander.y < -50 || lander.y > H + 20) {
                result = 'oob';
            } else if (stepCount >= MAX_STEPS) {
                result = 'timeout';
            } else {
                result = checkLanding();
            }

            // Compute reward
            const padCx = (padLeft + padRight) / 2;
            const padCy = padY;
            const dx = (lander.x - padCx) / W;
            const dy = (lander.y - padCy) / H;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (result === 'landed') {
                // Landing bonus — scaled to match per-frame rewards
                const uprightBonus = Math.max(0, 2 * (1 - Math.abs(lander.angle) / (20 * Math.PI / 180)));
                const gentleBonus = Math.max(0, 2 * (1 - Math.abs(lander.vy) / 1.5));
                reward = 10 + uprightBonus + gentleBonus;
            } else if (result === 'crash' || result === 'oob') {
                // Graduated crash penalty — soft crashes near pad are less punishing
                const speed = Math.sqrt(lander.vx * lander.vx + lander.vy * lander.vy);
                const distPenalty = Math.min(1, dist * 2);
                reward = -2 - 3 * Math.min(1, speed / 4) - 5 * distPenalty;
            } else if (result === 'timeout') {
                reward = -3;
            } else {
                // Dense per-frame reward — reward controlled approach
                const speed = Math.sqrt(lander.vx * lander.vx + lander.vy * lander.vy);
                const closeness = Math.max(0, 1 - dist / 0.8);

                // 1. Position reward: being close to pad
                reward = closeness * 0.4;

                // 2. Controlled approach: close AND slow (teaches braking)
                reward += closeness * Math.max(0, 3 - speed) * 0.3;

                // 3. Upright bonus (matters more near ground)
                const uprightness = 1 - Math.abs(lander.angle) / Math.PI;
                reward += uprightness * 0.15 * (0.5 + closeness * 0.5);

                // 4. Velocity toward pad when far away
                if (closeness < 0.5) {
                    const vTowardPadX = dx !== 0 ? -Math.sign(dx) * lander.vx : 0;
                    const vTowardPadY = dy !== 0 ? -Math.sign(dy) * lander.vy : 0;
                    reward += Math.max(0, vTowardPadX + vTowardPadY) * 0.3;
                }

                // 5. Near-pad slow bonus: strong reward for almost-landing state
                if (closeness > 0.7 && speed < 2.0) {
                    reward += 1.0;
                    if (speed < 1.0 && uprightness > 0.8) {
                        reward += 2.0;
                    }
                }

                // 6. Altitude penalty — discourages flying upward/away
                if (lander.y < padCy - 100) {
                    reward -= (padCy - 100 - lander.y) / H * 0.3;
                }

                // 7. Small time + fuel penalty
                reward -= 0.01;
                if (thrustMain) reward -= 0.01;
                if (thrustLeft || thrustRight) reward -= 0.005;
            }

            // Build 8D state
            const state = [
                (lander.x - padCx) / W,           // pad-relative X
                (lander.y - padCy) / H,           // pad-relative Y
                lander.vx / 5,                     // normalized vx
                lander.vy / 5,                     // normalized vy
                lander.angle / Math.PI,            // normalized angle
                lander.angVel / 0.2,               // normalized angular velocity
                leftContact,                        // left leg contact
                rightContact                        // right leg contact
            ];

            const done = result !== null;
            if (onStepDone) onStepDone(state, reward, done, result);

            // Spawn flame particles
            if (thrustMain || thrustLeft || thrustRight) {
                spawnFlameParticles();
            }

            if (done && onEpisodeEnd) {
                onEpisodeEnd(result);
            }

            return { state, reward, done, result };
        }

        // Flame particle system
        function spawnFlameParticles() {
            const cosA = Math.cos(lander.angle);
            const sinA = Math.sin(lander.angle);

            if (thrustMain) {
                // Bottom of lander
                const fx = lander.x + sinA * (LANDER_H / 2 + 2);
                const fy = lander.y + cosA * (LANDER_H / 2 + 2);
                for (let i = 0; i < 2; i++) {
                    flames.push({
                        x: fx + (Math.random() - 0.5) * 6,
                        y: fy + (Math.random() - 0.5) * 3,
                        vx: sinA * (1.5 + Math.random()) + (Math.random() - 0.5) * 0.5,
                        vy: cosA * (1.5 + Math.random()) + (Math.random() - 0.5) * 0.5,
                        life: 8 + Math.random() * 8,
                        maxLife: 16
                    });
                }
            }

            if (thrustLeft) {
                const fx = lander.x - cosA * 10;
                const fy = lander.y - sinA * 10;
                flames.push({
                    x: fx, y: fy,
                    vx: -cosA * 1.5 + (Math.random() - 0.5) * 0.5,
                    vy: -sinA * 1.5 + (Math.random() - 0.5) * 0.5,
                    life: 6 + Math.random() * 6, maxLife: 12
                });
            }

            if (thrustRight) {
                const fx = lander.x + cosA * 10;
                const fy = lander.y + sinA * 10;
                flames.push({
                    x: fx, y: fy,
                    vx: cosA * 1.5 + (Math.random() - 0.5) * 0.5,
                    vy: sinA * 1.5 + (Math.random() - 0.5) * 0.5,
                    life: 6 + Math.random() * 6, maxLife: 12
                });
            }
        }

        function updateFlames() {
            for (let i = flames.length - 1; i >= 0; i--) {
                const f = flames[i];
                f.x += f.vx;
                f.y += f.vy;
                f.vy += 0.02; // slight gravity on particles
                f.life--;
                if (f.life <= 0) {
                    flames.splice(i, 1);
                }
            }
        }

        // Theme colors
        function getColors() {
            const s = getComputedStyle(document.documentElement);
            const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
            return {
                lander: s.getPropertyValue('--neon-cyan').trim() || '#00f0ff',
                pad: s.getPropertyValue('--neon-green').trim() || '#39ff14',
                terrain: isDark ? '#2a3a4a' : '#7a8a9a',
                terrainFill: isDark ? 'rgba(20, 35, 50, 0.8)' : 'rgba(180, 200, 220, 0.6)',
                bg: getComputedStyle(canvas).backgroundColor || '#0a0a12',
                text: s.getPropertyValue('--text-primary').trim() || '#ffffff',
                flame: '#ff6600',
                flameHot: '#ffcc00',
                stars: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.15)'
            };
        }

        // Stars (background decoration)
        let stars = [];
        function generateStars() {
            stars = [];
            for (let i = 0; i < 80; i++) {
                stars.push({
                    x: Math.random() * W,
                    y: Math.random() * H * 0.6,
                    r: 0.5 + Math.random() * 1.5,
                    twinkle: Math.random() * Math.PI * 2
                });
            }
        }
        generateStars();

        // Render
        function render() {
            const c = getColors();
            const sx = canvas.width / W;
            const sy = canvas.height / H;

            ctx.setTransform(sx, 0, 0, sy, 0, 0);
            ctx.clearRect(0, 0, W, H);

            // Background
            ctx.fillStyle = c.bg;
            ctx.fillRect(0, 0, W, H);

            // Stars
            ctx.fillStyle = c.stars;
            for (const star of stars) {
                const flicker = prefersReducedMotion ? 1 : 0.5 + 0.5 * Math.sin(star.twinkle + stepCount * 0.02);
                ctx.globalAlpha = flicker;
                ctx.beginPath();
                ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // Terrain fill
            ctx.fillStyle = c.terrainFill;
            ctx.beginPath();
            ctx.moveTo(0, H);
            for (const pt of terrain) {
                ctx.lineTo(pt.x, pt.y);
            }
            ctx.lineTo(W, H);
            ctx.closePath();
            ctx.fill();

            // Terrain line
            ctx.strokeStyle = c.terrain;
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i < terrain.length; i++) {
                if (i === 0) ctx.moveTo(terrain[i].x, terrain[i].y);
                else ctx.lineTo(terrain[i].x, terrain[i].y);
            }
            ctx.stroke();

            // Landing pad
            const glow = !prefersReducedMotion;
            if (glow) {
                ctx.shadowColor = c.pad;
                ctx.shadowBlur = 12;
            }
            ctx.fillStyle = c.pad;
            ctx.fillRect(padLeft, padY - 3, PAD_W, 6);
            // Pad markers
            ctx.fillRect(padLeft + 5, padY - 7, 4, 4);
            ctx.fillRect(padRight - 9, padY - 7, 4, 4);
            ctx.shadowBlur = 0;

            // Flame particles
            updateFlames();
            for (const f of flames) {
                const t = f.life / f.maxLife;
                ctx.globalAlpha = t;
                ctx.fillStyle = t > 0.5 ? c.flameHot : c.flame;
                const size = 2 + t * 3;
                ctx.fillRect(f.x - size / 2, f.y - size / 2, size, size);
            }
            ctx.globalAlpha = 1;

            // Lander
            ctx.save();
            ctx.translate(lander.x, lander.y);
            ctx.rotate(lander.angle);

            if (glow) {
                ctx.shadowColor = c.lander;
                ctx.shadowBlur = 15;
            }

            // Body — triangle
            ctx.fillStyle = c.lander;
            ctx.beginPath();
            ctx.moveTo(0, -LANDER_H / 2);                     // top
            ctx.lineTo(-LANDER_W / 2, LANDER_H / 2);         // bottom-left
            ctx.lineTo(LANDER_W / 2, LANDER_H / 2);          // bottom-right
            ctx.closePath();
            ctx.fill();

            // Legs
            ctx.strokeStyle = c.lander;
            ctx.lineWidth = 2;
            // Left leg
            ctx.beginPath();
            ctx.moveTo(-LANDER_W / 2 + 2, LANDER_H / 2);
            ctx.lineTo(-LEG_SPAN, LANDER_H / 2 + LEG_H);
            ctx.stroke();
            // Right leg
            ctx.beginPath();
            ctx.moveTo(LANDER_W / 2 - 2, LANDER_H / 2);
            ctx.lineTo(LEG_SPAN, LANDER_H / 2 + LEG_H);
            ctx.stroke();

            // Leg feet (small horizontal lines)
            ctx.beginPath();
            ctx.moveTo(-LEG_SPAN - 4, LANDER_H / 2 + LEG_H);
            ctx.lineTo(-LEG_SPAN + 4, LANDER_H / 2 + LEG_H);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(LEG_SPAN - 4, LANDER_H / 2 + LEG_H);
            ctx.lineTo(LEG_SPAN + 4, LANDER_H / 2 + LEG_H);
            ctx.stroke();

            ctx.shadowBlur = 0;

            // Thrust flame (rendered on lander, so it rotates with it)
            if (thrustMain) {
                const flameLen = 10 + Math.random() * 12;
                ctx.fillStyle = c.flameHot;
                ctx.globalAlpha = 0.9;
                ctx.beginPath();
                ctx.moveTo(-5, LANDER_H / 2 + 1);
                ctx.lineTo(5, LANDER_H / 2 + 1);
                ctx.lineTo(0, LANDER_H / 2 + flameLen);
                ctx.closePath();
                ctx.fill();
                ctx.globalAlpha = 1;
            }

            ctx.restore();

            // HUD text — altitude + speed on canvas
            ctx.font = '12px "Share Tech Mono", monospace';
            ctx.textAlign = 'left';
            ctx.fillStyle = c.text;
            ctx.globalAlpha = 0.4;
            const alt = Math.max(0, padY - lander.y - LANDER_H / 2 - LEG_H).toFixed(0);
            const spd = Math.sqrt(lander.vx * lander.vx + lander.vy * lander.vy).toFixed(1);
            ctx.fillText('ALT ' + alt, 10, 20);
            ctx.fillText('SPD ' + spd, 10, 36);
            ctx.fillText('ANG ' + (lander.angle * 180 / Math.PI).toFixed(0) + '\u00B0', 10, 52);
            ctx.globalAlpha = 1;
        }

        // Game loop
        let rafId = null;
        let currentAction = 0;

        function loop() {
            step(currentAction);
            render();
            if (running) rafId = requestAnimationFrame(loop);
        }

        function start(level) {
            if (running) return;
            generateTerrain();
            spawnLander(level || 0);
            running = true;
            rafId = requestAnimationFrame(loop);
        }

        function stop() {
            running = false;
            if (rafId) cancelAnimationFrame(rafId);
        }

        function resetEpisode(level) {
            spawnLander(level || 0);
        }

        // Keyboard controls
        const keysDown = {};
        document.addEventListener('keydown', function (e) {
            if (['ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                keysDown[e.key] = true;
            }
        });
        document.addEventListener('keyup', function (e) {
            keysDown[e.key] = false;
        });

        function getKeyboardAction() {
            if (keysDown['ArrowUp']) return ACTIONS.THRUST_MAIN;
            if (keysDown['ArrowLeft']) return ACTIONS.ROTATE_LEFT;
            if (keysDown['ArrowRight']) return ACTIONS.ROTATE_RIGHT;
            return ACTIONS.NOOP;
        }

        return {
            start,
            stop,
            render,
            step,
            resetEpisode,
            generateTerrain,
            spawnLander,
            setAction(a) { currentAction = a; },
            setOnStepDone(fn) { onStepDone = fn; },
            setOnEpisodeEnd(fn) { onEpisodeEnd = fn; },
            setWindEnabled(v) { windEnabled = v; },
            getKeyboardAction,
            getState() {
                const padCx = (padLeft + padRight) / 2;
                return [
                    (lander.x - padCx) / W,
                    (lander.y - padY) / H,
                    lander.vx / 5,
                    lander.vy / 5,
                    lander.angle / Math.PI,
                    lander.angVel / 0.2,
                    leftContact,
                    rightContact
                ];
            },
            getLander() { return { x: lander.x, y: lander.y, vx: lander.vx, vy: lander.vy, angle: lander.angle, angVel: lander.angVel }; },
            getW() { return W; },
            getH() { return H; },
            ACTIONS
        };
    }

    return { create };
})();
