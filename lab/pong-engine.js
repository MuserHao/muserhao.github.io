// ========== PONG ENGINE ==========
// Fixed 800x600 logical coordinate space. CSS scales the canvas.

const PongEngine = (function () {
    'use strict';

    // Logical dimensions
    const W = 800, H = 600;

    // Paddle
    const PAD_W = 14, PAD_H = 90, PAD_OFFSET = 30;

    // Ball
    const BALL_R = 8;
    const BALL_SPEED_INIT = 5;
    const BALL_SPEED_MAX = 9;
    const BALL_ACCEL = 0.15; // speed bump per paddle hit

    // Scoring
    const WIN_SCORE = 5;

    // Reduced motion check
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function create(canvas) {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        // Size canvas backing store
        function resize() {
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
        }
        resize();
        window.addEventListener('resize', resize);

        // State
        let playerY = H / 2;
        let aiY = H / 2;
        let ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
        let scorePlayer = 0, scoreAI = 0;
        let running = false;
        let aiAction = 1; // 0=UP, 1=STAY, 2=DOWN
        const AI_SPEED = 5;

        // Callbacks
        let onStepDone = null;
        let onRoundEnd = null;

        // Serve ball
        function serveBall() {
            ball.x = W / 2;
            ball.y = H / 2;
            const angle = (Math.random() - 0.5) * Math.PI / 3;
            const dir = Math.random() < 0.5 ? 1 : -1;
            ball.vx = dir * BALL_SPEED_INIT * Math.cos(angle);
            ball.vy = BALL_SPEED_INIT * Math.sin(angle);
        }

        // Get theme-aware colors from CSS custom properties
        function getColors() {
            const s = getComputedStyle(document.documentElement);
            const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
            return {
                player: s.getPropertyValue('--neon-cyan').trim() || '#00f0ff',
                ai: s.getPropertyValue('--neon-pink').trim() || '#ff006e',
                ball: isDark ? '#ffffff' : '#1e1e2e',
                net: s.getPropertyValue('--border-subtle').trim() || 'rgba(255,255,255,0.15)',
                bg: getComputedStyle(canvas).backgroundColor || '#0a0a12',
                text: s.getPropertyValue('--text-primary').trim() || '#ffffff'
            };
        }

        // Mouse / touch input
        function handlePointer(clientY) {
            const rect = canvas.getBoundingClientRect();
            const relY = (clientY - rect.top) / rect.height;
            playerY = relY * H;
            playerY = Math.max(PAD_H / 2, Math.min(H - PAD_H / 2, playerY));
        }

        canvas.addEventListener('mousemove', e => handlePointer(e.clientY));
        canvas.addEventListener('touchmove', e => {
            e.preventDefault();
            handlePointer(e.touches[0].clientY);
        }, { passive: false });
        canvas.addEventListener('touchstart', e => {
            e.preventDefault();
            handlePointer(e.touches[0].clientY);
        }, { passive: false });

        // Keyboard input (arrow keys, W/S)
        const keysDown = {};
        const PLAYER_SPEED = 6;
        document.addEventListener('keydown', e => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'w' || e.key === 's') {
                e.preventDefault();
                keysDown[e.key] = true;
            }
        });
        document.addEventListener('keyup', e => { keysDown[e.key] = false; });

        // Physics step
        function step() {
            // Keyboard-driven player movement
            if (keysDown['ArrowUp'] || keysDown['w']) {
                playerY -= PLAYER_SPEED;
                playerY = Math.max(PAD_H / 2, Math.min(H - PAD_H / 2, playerY));
            }
            if (keysDown['ArrowDown'] || keysDown['s']) {
                playerY += PLAYER_SPEED;
                playerY = Math.max(PAD_H / 2, Math.min(H - PAD_H / 2, playerY));
            }

            // Move AI paddle
            if (aiAction === 0) aiY -= AI_SPEED;
            else if (aiAction === 2) aiY += AI_SPEED;
            aiY = Math.max(PAD_H / 2, Math.min(H - PAD_H / 2, aiY));

            // Move ball
            ball.x += ball.vx;
            ball.y += ball.vy;

            // Top / bottom walls
            if (ball.y - BALL_R <= 0) {
                ball.y = BALL_R;
                ball.vy = Math.abs(ball.vy);
            }
            if (ball.y + BALL_R >= H) {
                ball.y = H - BALL_R;
                ball.vy = -Math.abs(ball.vy);
            }

            // Player paddle collision (left side)
            const playerLeft = PAD_OFFSET;
            const playerRight = PAD_OFFSET + PAD_W;
            const playerTop = playerY - PAD_H / 2;
            const playerBot = playerY + PAD_H / 2;

            if (ball.vx < 0 &&
                ball.x - BALL_R <= playerRight &&
                ball.x + BALL_R >= playerLeft &&
                ball.y >= playerTop && ball.y <= playerBot) {
                ball.x = playerRight + BALL_R;
                const hitPos = (ball.y - playerY) / (PAD_H / 2); // -1 to 1
                const angle = hitPos * Math.PI / 4;
                const speed = Math.min(Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy) + BALL_ACCEL, BALL_SPEED_MAX);
                ball.vx = speed * Math.cos(angle);
                ball.vy = speed * Math.sin(angle);
            }

            // AI paddle collision (right side)
            const aiLeft = W - PAD_OFFSET - PAD_W;
            const aiRight = W - PAD_OFFSET;
            const aiTop = aiY - PAD_H / 2;
            const aiBot = aiY + PAD_H / 2;
            let aiHitBall = false;

            if (ball.vx > 0 &&
                ball.x + BALL_R >= aiLeft &&
                ball.x - BALL_R <= aiRight &&
                ball.y >= aiTop && ball.y <= aiBot) {
                ball.x = aiLeft - BALL_R;
                const hitPos = (ball.y - aiY) / (PAD_H / 2);
                const angle = hitPos * Math.PI / 4;
                const speed = Math.min(Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy) + BALL_ACCEL, BALL_SPEED_MAX);
                ball.vx = -speed * Math.cos(angle);
                ball.vy = speed * Math.sin(angle);
                aiHitBall = true;
            }

            // Scoring & reward
            let reward = 0;
            let done = false;

            if (ball.x < 0) {
                // AI scores
                scoreAI++;
                reward = 1;
                if (scoreAI >= WIN_SCORE) {
                    done = true;
                } else {
                    serveBall();
                }
            } else if (ball.x > W) {
                // Player scores
                scorePlayer++;
                reward = -1;
                if (scorePlayer >= WIN_SCORE) {
                    done = true;
                } else {
                    serveBall();
                }
            } else {
                // Dense reward shaping
                // +0.3 for successfully hitting the ball (biggest learning signal)
                if (aiHitBall) {
                    reward = 0.3;
                } else {
                    // Small proximity reward: encourage tracking the ball
                    const dist = Math.abs(aiY - ball.y) / H;
                    reward = -0.01 * dist;
                }
            }

            // Build state for RL
            const state = [
                ball.x / W,
                ball.y / H,
                ball.vx / BALL_SPEED_MAX,
                ball.vy / BALL_SPEED_MAX,
                aiY / H,
                playerY / H
            ];

            // Discrete state for Q-learning
            const discreteState = discretize(ball.x, ball.y, ball.vx, ball.vy, aiY);

            if (onStepDone) onStepDone(state, discreteState, reward, done);

            if (done) {
                const winner = scoreAI >= WIN_SCORE ? 'ai' : 'player';
                if (onRoundEnd) onRoundEnd(winner);
                scorePlayer = 0;
                scoreAI = 0;
                serveBall();
            }
        }

        // Discretize state for Q-learning
        function discretize(bx, by, bvx, bvy, ay) {
            const bxBin = Math.min(Math.floor(bx / W * 8), 7);
            const byBin = Math.min(Math.floor(by / H * 6), 5);
            const vxBin = bvx > 0 ? 1 : 0;
            const vyBin = bvy > 0.5 ? 2 : (bvy < -0.5 ? 0 : 1);
            const ayBin = Math.min(Math.floor(ay / H * 6), 5);
            return bxBin * 6 * 2 * 3 * 6 + byBin * 2 * 3 * 6 + vxBin * 3 * 6 + vyBin * 6 + ayBin;
        }

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

            // Center net
            ctx.setLineDash([8, 8]);
            ctx.strokeStyle = c.net;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(W / 2, 0);
            ctx.lineTo(W / 2, H);
            ctx.stroke();
            ctx.setLineDash([]);

            const glow = !prefersReducedMotion;

            // Player paddle (left)
            if (glow) {
                ctx.shadowColor = c.player;
                ctx.shadowBlur = 15;
            }
            ctx.fillStyle = c.player;
            ctx.fillRect(PAD_OFFSET, playerY - PAD_H / 2, PAD_W, PAD_H);
            ctx.shadowBlur = 0;

            // AI paddle (right)
            if (glow) {
                ctx.shadowColor = c.ai;
                ctx.shadowBlur = 15;
            }
            ctx.fillStyle = c.ai;
            ctx.fillRect(W - PAD_OFFSET - PAD_W, aiY - PAD_H / 2, PAD_W, PAD_H);
            ctx.shadowBlur = 0;

            // Ball
            if (glow) {
                ctx.shadowColor = c.ball;
                ctx.shadowBlur = 20;
            }
            ctx.fillStyle = c.ball;
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            // Score display
            ctx.font = '48px Orbitron, monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = c.text;
            ctx.globalAlpha = 0.3;
            ctx.fillText(scorePlayer, W / 4, 60);
            ctx.fillText(scoreAI, (3 * W) / 4, 60);
            ctx.globalAlpha = 1;
        }

        // Game loop
        let rafId = null;
        function loop() {
            step();
            render();
            if (running) rafId = requestAnimationFrame(loop);
        }

        function start() {
            if (running) return;
            running = true;
            serveBall();
            rafId = requestAnimationFrame(loop);
        }

        function stop() {
            running = false;
            if (rafId) cancelAnimationFrame(rafId);
        }

        function reset() {
            scorePlayer = 0;
            scoreAI = 0;
            playerY = H / 2;
            aiY = H / 2;
            serveBall();
        }

        return {
            start,
            stop,
            reset,
            render,
            setAIAction(a) { aiAction = a; },
            setPlayerY(y) { playerY = Math.max(PAD_H / 2, Math.min(H - PAD_H / 2, y)); },
            setOnStepDone(fn) { onStepDone = fn; },
            setOnRoundEnd(fn) { onRoundEnd = fn; },
            step,
            getBall() { return { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy }; },
            getH() { return H; },
            getState() {
                return [
                    ball.x / W, ball.y / H,
                    ball.vx / BALL_SPEED_MAX, ball.vy / BALL_SPEED_MAX,
                    aiY / H, playerY / H
                ];
            }
        };
    }

    return { create };
})();
