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
        let prevPotential = null;

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
            prevPotential = null;
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

            // Both feet on the pad surface (within 3px)
            const legsTouchingGround = tips.left.y >= padY - 3 && tips.right.y >= padY - 3;

            const onPad = legsTouchingGround &&
                          tips.left.x >= padLeft && tips.left.x <= padRight &&
                          tips.right.x >= padLeft && tips.right.x <= padRight;
            const upright = Math.abs(lander.angle) < (20 * Math.PI / 180);
            const slow = Math.abs(lander.vy) < 1.5 && Math.abs(lander.vx) < 0.8;

            if (onPad && upright && slow) return 'landed';

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

        // Φ(s): distance to the pad (in 100 px), speed and tilt all lower it;
        // each foot on the ground raises it a little.
        function shapingPotential(padCx) {
            const dx = (lander.x - padCx) / 100;
            const dy = (lander.y - padY) / 100;
            const speed = Math.sqrt(lander.vx * lander.vx + lander.vy * lander.vy);
            return -3 * Math.sqrt(dx * dx + dy * dy) - 3 * speed - 3 * Math.abs(lander.angle)
                   + 0.5 * (leftContact + rightContact);
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

        // Agent step: run FRAME_SKIP physics frames, fire callback once with summed reward
        // Currently unused (frame skip hurts DQN/PPO at our episode length)
        function stepAgent() {
            var res = stepRaw(currentAction);
            if (onStepDone) onStepDone(res.state, res.reward, res.done, res.result);
            if (res.done && onEpisodeEnd) onEpisodeEnd(res.result);
        }

        // Raw physics step — no callbacks, returns state/reward/done
        function stepRaw(action) {
            applyAction(action);

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

            if (lander.x < -20 || lander.x > W + 20 || lander.y < -50 || lander.y > H + 20) {
                result = 'oob';
            } else if (stepCount >= MAX_STEPS) {
                result = 'timeout';
            } else {
                result = checkLanding();
            }

            // Leg contact sensors: is each foot touching the ground?
            const tips = getLegTips();
            leftContact = tips.left.y >= terrainHeightAt(tips.left.x) - 3 ? 1 : 0;
            rightContact = tips.right.y >= terrainHeightAt(tips.right.x) - 3 ? 1 : 0;

            // Reward = potential-based shaping + terminal bonus + fuel cost.
            // Φ(s) is higher when the lander is close to the pad, slow and level.
            // Each frame pays Φ(s') − Φ(s), so moving toward a good state earns
            // reward and moving away costs the same amount back. Hovering earns
            // nothing, so the only way to collect real reward is to land.
            // (Ng, Harada & Russell 1999; the same trick as Gym's LunarLander.)
            const padCx = (padLeft + padRight) / 2;
            const potential = shapingPotential(padCx);
            let reward = prevPotential === null ? 0 : potential - prevPotential;
            prevPotential = potential;
            if (thrustMain) reward -= 0.03;
            if (thrustLeft || thrustRight) reward -= 0.003;

            if (result === 'landed') reward += 10;
            else if (result === 'crash' || result === 'oob') reward -= 10;
            else if (result === 'timeout') reward -= 10;   // hovering until time runs out is a failure too

            // Build 8D state
            const state = [
                (lander.x - padCx) / 200,         // pad-relative X
                (lander.y - padY) / 200,          // pad-relative Y
                lander.vx / 5,                     // normalized vx
                lander.vy / 5,                     // normalized vy
                lander.angle / Math.PI,            // normalized angle
                lander.angVel / 0.2,               // normalized angular velocity
                leftContact,                        // left leg contact
                rightContact                        // right leg contact
            ];

            const done = result !== null;

            // Spawn flame particles
            if (thrustMain || thrustLeft || thrustRight) {
                spawnFlameParticles();
            }

            return { state, reward, done, result };
        }

        // Backwards-compatible step() — single physics frame, no callbacks
        // Game loop uses this for rendering; training uses stepAgent()
        function step(action) {
            return stepRaw(action !== undefined ? action : currentAction);
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

        // Xeno palette (the Lab is always night). Read once and cached; the
        // canvas background comes from CSS so the screen matches the page.
        function getColors() {
            if (getColors.cache) return getColors.cache;
            const bg = getComputedStyle(canvas).backgroundColor;
            getColors.cache = {
                lander: '#8ff6ff',
                hull: '#0d0f22',
                legs: '#aab2d4',
                pad: '#8ff6ff',
                beacon: '#ffe3a3',
                terrain: 'rgba(170, 178, 212, 0.55)',
                terrainTop: '#12142a',
                contour: '157, 140, 255',
                bg: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#05060d',
                text: '#8a93b8',
                flame: '#ff8ad8',
                flameHot: '#ffe3a3',
                stars: '#eef1ff'
            };
            return getColors.cache;
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
            const glow = !prefersReducedMotion;

            ctx.setTransform(sx, 0, 0, sy, 0, 0);

            // Gradients that never change are built once
            if (!render.g) {
                const sky = ctx.createLinearGradient(0, 0, 0, H);
                sky.addColorStop(0, 'rgba(157, 140, 255, 0)');
                sky.addColorStop(0.7, 'rgba(157, 140, 255, 0.06)');
                sky.addColorStop(1, 'rgba(143, 246, 255, 0.03)');
                const ground = ctx.createLinearGradient(0, H * 0.45, 0, H);
                ground.addColorStop(0, c.terrainTop);
                ground.addColorStop(1, c.bg);
                const ridge = ctx.createLinearGradient(0, 0, W, 0);
                ridge.addColorStop(0, 'rgba(143, 246, 255, 0.45)');
                ridge.addColorStop(0.35, 'rgba(157, 140, 255, 0.6)');
                ridge.addColorStop(0.7, 'rgba(255, 138, 216, 0.45)');
                ridge.addColorStop(1, 'rgba(255, 227, 163, 0.4)');
                // chrome/iridescent hull rim, in lander-local coords
                const rim = ctx.createLinearGradient(-LANDER_W / 2, -LANDER_H / 2, LANDER_W / 2, LANDER_H / 2);
                rim.addColorStop(0, '#8ff6ff');
                rim.addColorStop(0.4, '#9d8cff');
                rim.addColorStop(0.7, '#ff8ad8');
                rim.addColorStop(1, '#ffe3a3');
                const plume = ctx.createLinearGradient(0, LANDER_H / 2, 0, LANDER_H / 2 + 24);
                plume.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
                plume.addColorStop(0.35, 'rgba(255, 227, 163, 0.85)');
                plume.addColorStop(1, 'rgba(255, 138, 216, 0)');
                render.g = { sky, ground, ridge, rim, plume };
            }
            const g = render.g;

            // Background
            ctx.fillStyle = c.bg;
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = g.sky;
            ctx.fillRect(0, 0, W, H);

            // Stars: tiny squares, slow shimmer
            ctx.fillStyle = c.stars;
            for (const star of stars) {
                const flicker = prefersReducedMotion ? 0.6 : 0.35 + 0.35 * Math.sin(star.twinkle + stepCount * 0.02);
                ctx.globalAlpha = flicker;
                ctx.fillRect(star.x, star.y, star.r, star.r);
            }
            ctx.globalAlpha = 1;

            // Terrain fill
            ctx.fillStyle = g.ground;
            ctx.beginPath();
            ctx.moveTo(0, H);
            for (const pt of terrain) {
                ctx.lineTo(pt.x, pt.y);
            }
            ctx.lineTo(W, H);
            ctx.closePath();
            ctx.fill();

            // Contour lines: the ridge echoed downward, fading
            ctx.lineWidth = 1;
            for (let k = 1; k <= 4; k++) {
                ctx.strokeStyle = 'rgba(' + c.contour + ', ' + (0.2 - k * 0.04).toFixed(2) + ')';
                ctx.beginPath();
                for (let i = 0; i < terrain.length; i++) {
                    const y = terrain[i].y + k * 16;
                    if (i === 0) ctx.moveTo(terrain[i].x, y);
                    else ctx.lineTo(terrain[i].x, y);
                }
                ctx.stroke();
            }

            // Ridge line: iridescent hairline
            ctx.strokeStyle = g.ridge;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < terrain.length; i++) {
                if (i === 0) ctx.moveTo(terrain[i].x, terrain[i].y);
                else ctx.lineTo(terrain[i].x, terrain[i].y);
            }
            ctx.stroke();

            // Landing pad: soft pool of light + bright bar + blinking beacons
            const padCx = (padLeft + padRight) / 2;
            const pool = ctx.createRadialGradient(padCx, padY, 0, padCx, padY, PAD_W);
            pool.addColorStop(0, 'rgba(143, 246, 255, 0.18)');
            pool.addColorStop(1, 'rgba(143, 246, 255, 0)');
            ctx.fillStyle = pool;
            ctx.fillRect(padCx - PAD_W, padY - PAD_W, PAD_W * 2, PAD_W * 2);
            ctx.fillStyle = c.pad;
            ctx.fillRect(padLeft, padY - 2, PAD_W, 4);
            ctx.globalAlpha = glow ? (Math.floor(stepCount / 20) % 2 ? 1 : 0.35) : 1;
            ctx.fillStyle = c.beacon;
            ctx.fillRect(padLeft + 2, padY - 8, 3, 3);
            ctx.fillRect(padRight - 5, padY - 8, 3, 3);
            ctx.globalAlpha = 1;

            // Flame particles
            updateFlames();
            for (const f of flames) {
                const t = f.life / f.maxLife;
                ctx.globalAlpha = t * 0.85;
                ctx.fillStyle = t > 0.5 ? c.flameHot : c.flame;
                const size = 1.5 + t * 3;
                ctx.fillRect(f.x - size / 2, f.y - size / 2, size, size);
            }
            ctx.globalAlpha = 1;

            // Lander
            ctx.save();
            ctx.translate(lander.x, lander.y);
            ctx.rotate(lander.angle);

            // Thrust plume (drawn under the hull, rotates with it)
            if (thrustMain) {
                const flameLen = 12 + Math.random() * 12;
                ctx.save();
                ctx.scale(1, flameLen / 24);
                ctx.translate(0, LANDER_H / 2 * (1 - 24 / flameLen));
                ctx.fillStyle = g.plume;
                ctx.beginPath();
                ctx.moveTo(-6, LANDER_H / 2);
                ctx.lineTo(6, LANDER_H / 2);
                ctx.lineTo(0, LANDER_H / 2 + 24);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }

            // Legs + feet: chrome hairlines
            ctx.strokeStyle = c.legs;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(-LANDER_W / 2 + 2, LANDER_H / 2);
            ctx.lineTo(-LEG_SPAN, LANDER_H / 2 + LEG_H);
            ctx.moveTo(LANDER_W / 2 - 2, LANDER_H / 2);
            ctx.lineTo(LEG_SPAN, LANDER_H / 2 + LEG_H);
            ctx.moveTo(-LEG_SPAN - 4, LANDER_H / 2 + LEG_H);
            ctx.lineTo(-LEG_SPAN + 4, LANDER_H / 2 + LEG_H);
            ctx.moveTo(LEG_SPAN - 4, LANDER_H / 2 + LEG_H);
            ctx.lineTo(LEG_SPAN + 4, LANDER_H / 2 + LEG_H);
            ctx.stroke();

            // Body: dark hull, iridescent rim, cyan viewport
            ctx.beginPath();
            ctx.moveTo(0, -LANDER_H / 2);
            ctx.lineTo(-LANDER_W / 2, LANDER_H / 2);
            ctx.lineTo(LANDER_W / 2, LANDER_H / 2);
            ctx.closePath();
            ctx.fillStyle = c.hull;
            ctx.fill();
            ctx.strokeStyle = g.rim;
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, LANDER_H * 0.1, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = c.lander;
            ctx.fill();

            ctx.restore();

            // Telemetry — thin mono readout in the corner
            ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
            ctx.textAlign = 'left';
            ctx.fillStyle = c.text;
            const alt = Math.max(0, padY - lander.y - LANDER_H / 2 - LEG_H).toFixed(0);
            const spd = Math.sqrt(lander.vx * lander.vx + lander.vy * lander.vy).toFixed(1);
            ctx.fillText('ALT  ' + alt, 16, 24);
            ctx.fillText('SPD  ' + spd, 16, 40);
            ctx.fillText('ANG  ' + (lander.angle * 180 / Math.PI).toFixed(0) + '\u00B0', 16, 56);
            ctx.fillStyle = 'rgba(170, 178, 212, 0.25)';
            ctx.fillRect(16, 62, 56, 1);
        }

        // Game loop
        // Fixed 60 Hz physics so the lander falls at the same speed on 60/120/144 Hz screens
        const STEP_MS = 1000 / 60;
        let rafId = null;
        let currentAction = 0;
        let lastTime = null, accumulator = 0;

        function loop(now) {
            if (lastTime === null) lastTime = now;
            accumulator += Math.min(now - lastTime, 100);
            lastTime = now;
            while (accumulator >= STEP_MS) {
                stepAgent();
                accumulator -= STEP_MS;
            }
            render();
            if (running) rafId = requestAnimationFrame(loop);
        }

        function start(level) {
            if (running) return;
            generateTerrain();
            spawnLander(level || 0);
            running = true;
            lastTime = null;
            accumulator = 0;
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
            stepAgent,
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
                    (lander.x - padCx) / 200,
                    (lander.y - padY) / 200,
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
