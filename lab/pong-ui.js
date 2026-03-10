// ========== PONG UI ==========
// Connects PongEngine to RL agents, manages HUD, localStorage, algo switching

(function () {
    'use strict';

    const canvas = document.getElementById('pong-canvas');
    if (!canvas) return;

    const engine = PongEngine.create(canvas);

    // ---- Agents ----
    const agents = {
        qlearning: loadAgent('qlearning') || new PongRL.QLearningAgent(),
        dqn: loadAgent('dqn') || new PongRL.DQNAgent(),
        reinforce: loadAgent('reinforce') || new PongRL.ReinforceAgent()
    };

    let currentAlgo = 'qlearning';
    let agent = agents[currentAlgo];
    let prevDiscreteState = null;
    let prevState = null;
    let prevAction = null;
    let gameStarted = false;
    let autoTraining = false;
    let trainTarget = 0;
    let trainStart = 0;
    let trainRafId = null;

    // ---- HUD elements ----
    const hudAlgo = document.getElementById('hud-algo');
    const hudEpisode = document.getElementById('hud-episode');
    const hudWinrate = document.getElementById('hud-winrate');
    const hudEpsilon = document.getElementById('hud-epsilon');
    const overlay = document.getElementById('canvas-overlay');

    // ---- Algorithm info descriptions ----
    const algoInfo = {
        qlearning: {
            title: 'Q-Learning',
            text: 'The simplest RL algorithm here. It builds a big lookup table mapping every game state to the best action (UP / STAY / DOWN). Each frame it updates one entry in the table based on the reward it received. Early on it explores randomly (\u03B5-greedy), but as \u03B5 decays it exploits what it\u2019s learned. You should see improvement within ~20 rounds.'
        },
        dqn: {
            title: 'Deep Q-Network (DQN)',
            text: 'Instead of a lookup table, DQN uses a tiny neural network (6 inputs \u2192 32 hidden \u2192 3 outputs) to estimate Q-values for each action. It stores experiences in a replay buffer and trains on random mini-batches after each episode. A separate "target network" stabilizes learning. Slower to start, but handles continuous states better. Expect improvement around ~50\u2013100 episodes.'
        },
        reinforce: {
            title: 'REINFORCE (Policy Gradient)',
            text: 'Unlike Q-Learning and DQN which learn action values, REINFORCE directly learns a policy \u2014 a probability distribution over actions. After each full episode it computes discounted returns, normalizes them as advantages, and updates the network to make rewarding actions more likely. Learning is noisier and slower (~100\u2013200 episodes), but it\u2019s the foundation of modern policy optimization (PPO, etc).'
        }
    };

    // ---- Update HUD ----
    function updateHUD() {
        const a = agents[currentAlgo];
        hudAlgo.textContent = currentAlgo === 'qlearning' ? 'Q-LEARNING' : currentAlgo.toUpperCase();
        hudEpisode.textContent = a.episodes;
        const wr = a.totalGames > 0 ? Math.round(a.wins / a.totalGames * 100) : 0;
        hudWinrate.textContent = wr;
        const eps = a.epsilon !== undefined ? a.epsilon.toFixed(2) : '\u2014';
        hudEpsilon.textContent = eps;
        var hudBot = document.getElementById('hud-bot');
        if (autoTraining && typeof adaptiveBotStrength === 'function') {
            var s = adaptiveBotStrength();
            hudBot.textContent = Math.round(s * 100) + '%';
        } else if (autoTraining || warmingUp) {
            hudBot.textContent = 'BOT';
        } else {
            hudBot.textContent = 'YOU';
        }
    }

    // ---- Update info card ----
    function updateInfoCard() {
        const info = algoInfo[currentAlgo];
        document.getElementById('algo-info-title').textContent = info.title;
        document.getElementById('algo-info-text').textContent = info.text;
    }

    // ---- localStorage persistence ----
    function saveAgent(name) {
        try {
            const data = agents[name].serialize();
            localStorage.setItem('pong_rl_' + name, JSON.stringify(data));
        } catch (e) { /* quota exceeded — silently skip */ }
    }

    function loadAgent(name) {
        try {
            const raw = localStorage.getItem('pong_rl_' + name);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (name === 'qlearning') return PongRL.QLearningAgent.deserialize(data);
            if (name === 'dqn') return PongRL.DQNAgent.deserialize(data);
            if (name === 'reinforce') return PongRL.ReinforceAgent.deserialize(data);
        } catch (e) { return null; }
        return null;
    }

    // ---- Engine callbacks ----
    engine.setOnStepDone(function (state, discreteState, reward, done) {
        const a = agents[currentAlgo];

        if (currentAlgo === 'qlearning') {
            // Q-learning: update from previous step
            if (prevDiscreteState !== null) {
                a.update(prevDiscreteState, prevAction, reward, discreteState, done);
            }
            const action = a.chooseAction(discreteState);
            engine.setAIAction(action);
            prevDiscreteState = discreteState;
            prevAction = action;
        } else if (currentAlgo === 'dqn') {
            // DQN: store transition from previous step, choose action
            if (prevAction !== null && prevState !== null) {
                a.storeTransition(prevState, prevAction, reward, state, done);
            }
            const action = a.chooseAction(state);
            engine.setAIAction(action);
            prevState = state.slice();
            prevAction = action;
        } else if (currentAlgo === 'reinforce') {
            // REINFORCE: store step, choose action
            const action = a.chooseAction(state);
            a.storeStep(state, action, reward);
            engine.setAIAction(action);
        }
    });

    engine.setOnRoundEnd(function (winner) {
        const a = agents[currentAlgo];
        a.onEpisodeEnd(winner);

        // Track rolling results for adaptive bot difficulty
        recentResults.push(winner === 'ai');
        if (recentResults.length > ROLLING_WINDOW) recentResults.shift();

        // Save periodically (not every episode during fast training)
        if (!autoTraining && !warmingUp) {
            saveAgent(currentAlgo);
            updateHUD();
        } else if (a.episodes % 10 === 0) {
            saveAgent(currentAlgo);
        }

        // Reset per-episode state
        prevDiscreteState = null;
        prevState = null;
        prevAction = null;
    });

    // ---- Auto-train: bot plays the player side at high speed ----
    const trainBtn = document.getElementById('train-btn');
    const trainSelect = document.getElementById('train-episodes');
    const trainProgress = document.getElementById('train-progress');
    const STEPS_PER_FRAME = 200;

    // Bot opponent with configurable strength (0 = random, 1 = near-perfect)
    function botMovePlayer(strength) {
        var ball = engine.getBall();
        var H = engine.getH();
        var noise = (1 - strength) * 60;       // weak bot = very noisy
        var speed = 1.5 + strength * 4.5;      // weak bot = slow
        var target = ball.y + (Math.random() - 0.5) * noise;
        var st = engine.getState();
        var pY = st[5] * H;
        var diff = target - pY;
        engine.setPlayerY(pY + Math.sign(diff) * Math.min(Math.abs(diff), speed));
    }

    // Track rolling win rate over last N episodes for adaptive difficulty
    var recentResults = []; // true = AI win, false = AI loss
    var ROLLING_WINDOW = 20;

    function rollingWinRate() {
        if (recentResults.length === 0) return 0;
        var wins = 0;
        for (var i = 0; i < recentResults.length; i++) {
            if (recentResults[i]) wins++;
        }
        return wins / recentResults.length;
    }

    // Adaptive bot: scales difficulty to match AI's current ability
    // This is curriculum learning — AI always faces an appropriate challenge
    function adaptiveBotStrength() {
        var wr = rollingWinRate();
        // AI losing badly → very weak bot (so AI can score and get +1 rewards)
        // AI winning often → strong bot (forces AI to learn real strategies)
        if (wr < 0.15) return 0.1;
        if (wr < 0.30) return 0.25;
        if (wr < 0.45) return 0.4;
        if (wr < 0.60) return 0.55;
        if (wr < 0.75) return 0.7;
        return 0.85;
    }

    function autoTrainFrame() {
        var a = agents[currentAlgo];
        var strength = adaptiveBotStrength();
        for (var i = 0; i < STEPS_PER_FRAME; i++) {
            botMovePlayer(strength);
            engine.step();
        }
        engine.render();

        var done = a.episodes - trainStart;
        var wr = Math.round(rollingWinRate() * 100);
        trainProgress.textContent = done + '/' + trainTarget + '  (' + wr + '% win)';

        if (done >= trainTarget) {
            stopAutoTrain();
            return;
        }
        trainRafId = requestAnimationFrame(autoTrainFrame);
    }

    function startAutoTrain() {
        if (autoTraining) { stopAutoTrain(); return; }

        // Ensure game is initialized
        if (!gameStarted) {
            gameStarted = true;
            overlay.classList.add('hidden');
        }
        engine.stop(); // stop the normal game loop

        autoTraining = true;
        trainTarget = parseInt(trainSelect.value, 10);
        trainStart = agents[currentAlgo].episodes;
        trainBtn.innerHTML = '<i class="fas fa-stop"></i> STOP';
        trainBtn.classList.add('training');
        trainSelect.disabled = true;
        document.querySelectorAll('.algo-tab').forEach(t => t.disabled = true);

        engine.reset();
        prevDiscreteState = null;
        prevState = null;
        prevAction = null;
        recentResults = []; // fresh rolling tracker

        trainRafId = requestAnimationFrame(autoTrainFrame);
    }

    function stopAutoTrain() {
        autoTraining = false;
        if (trainRafId) { cancelAnimationFrame(trainRafId); trainRafId = null; }
        trainBtn.innerHTML = '<i class="fas fa-bolt"></i> AUTO-TRAIN';
        trainBtn.classList.remove('training');
        trainSelect.disabled = false;
        document.querySelectorAll('.algo-tab').forEach(t => t.disabled = false);
        trainProgress.textContent = '';
        saveAgent(currentAlgo);
        updateHUD();

        // Resume normal game loop
        engine.reset();
        engine.start();
    }

    trainBtn.addEventListener('click', startAutoTrain);

    // ---- Algorithm tab switching ----
    document.querySelectorAll('.algo-tab').forEach(tab => {
        tab.addEventListener('click', function () {
            const algo = this.dataset.algo;
            if (algo === currentAlgo) return;
            if (autoTraining) stopAutoTrain();

            // Update active tab
            document.querySelectorAll('.algo-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');

            // Switch
            currentAlgo = algo;
            agent = agents[currentAlgo];
            prevDiscreteState = null;
            prevState = null;
            prevAction = null;
            recentResults = [];

            // Reset game state but keep agent learned state
            engine.reset();
            updateHUD();
            updateInfoCard();
        });
    });

    // ---- Start game on first interaction ----
    function startGame() {
        if (gameStarted) return;
        gameStarted = true;
        overlay.classList.add('hidden');
        engine.start();
        updateHUD();
    }

    canvas.addEventListener('mousemove', startGame, { once: true });
    canvas.addEventListener('touchstart', startGame, { once: true });
    document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'w' || e.key === 's') {
            startGame();
            document.removeEventListener('keydown', onKey);
        }
    });

    // Initial HUD + info
    updateHUD();
    updateInfoCard();

    // ---- Boot sequence: background training with loading screen ----
    // First-time visitors see a cool boot animation while agents train.
    // Returning visitors (agents in localStorage) skip straight to play.
    var overlayMain = overlay.querySelector('p');
    var overlaySub = overlay.querySelector('.overlay-sub');
    var warmingUp = false;

    var WARMUP_EPISODES = { qlearning: 100, dqn: 150, reinforce: 200 };
    var WARMUP_BUDGET_MS = 8;

    var bootMessages = [
        'INITIALIZING NEURAL NETWORK...',
        'LOADING Q-TABLE INTO MEMORY...',
        'CALIBRATING REWARD SIGNALS...',
        'TRAINING Q-LEARNING AGENT...',
        'TRAINING DQN AGENT...',
        'TRAINING REINFORCE AGENT...',
        'OPTIMIZING POLICY GRADIENTS...',
        'FINALIZING WEIGHT MATRICES...',
        'AGENTS READY.'
    ];

    function warmupAgentAsync(algoName) {
        return new Promise(function (resolve) {
            var a = agents[algoName];
            var target = WARMUP_EPISODES[algoName] || 0;
            if (a.episodes >= target) { resolve(); return; }

            currentAlgo = algoName;
            prevDiscreteState = null;
            prevState = null;
            prevAction = null;
            engine.reset();

            // Aggressive hyperparameters for fast convergence
            var origDecay, origLr;
            if (a.epsilonDecay !== undefined) {
                origDecay = a.epsilonDecay;
                a.epsilonDecay = 0.97;
            }
            if (algoName === 'dqn' || algoName === 'reinforce') {
                origLr = a.lr;
                a.lr = 0.003;
            }

            function botStrength() {
                return 0.3 + (a.episodes / target) * 0.6;
            }

            function chunk() {
                var deadline = performance.now() + WARMUP_BUDGET_MS;
                while (a.episodes < target && performance.now() < deadline) {
                    botMovePlayer(botStrength());
                    engine.step();
                }

                // Update boot screen
                var totalEps = WARMUP_EPISODES.qlearning + WARMUP_EPISODES.dqn + WARMUP_EPISODES.reinforce;
                var doneEps = Math.min(agents.qlearning.episodes, WARMUP_EPISODES.qlearning)
                    + Math.min(agents.dqn.episodes, WARMUP_EPISODES.dqn)
                    + Math.min(agents.reinforce.episodes, WARMUP_EPISODES.reinforce);
                var pct = Math.min(100, Math.round(doneEps / totalEps * 100));
                var msgIdx = Math.min(Math.floor(pct / 12), bootMessages.length - 1);
                overlayMain.textContent = bootMessages[msgIdx];
                overlaySub.textContent = '[ ' + pct + '% ]';

                if (a.episodes >= target) {
                    if (origDecay !== undefined) a.epsilonDecay = origDecay;
                    if (origLr !== undefined) a.lr = origLr;
                    if (a.epsilon !== undefined) a.epsilon = 0.12;
                    a.wins = 0;
                    a.totalGames = 0;
                    saveAgent(algoName);
                    resolve();
                } else {
                    setTimeout(chunk, 0);
                }
            }
            chunk();
        });
    }

    // Check if any agent needs training
    var needsWarmup = ['qlearning', 'dqn', 'reinforce'].some(function (name) {
        return agents[name].episodes < (WARMUP_EPISODES[name] || 0);
    });

    if (needsWarmup) {
        warmingUp = true;
        overlayMain.textContent = bootMessages[0];
        overlaySub.textContent = '[ 0% ]';

        warmupAgentAsync('qlearning')
            .then(function () { return warmupAgentAsync('dqn'); })
            .then(function () { return warmupAgentAsync('reinforce'); })
            .then(function () {
                warmingUp = false;
                currentAlgo = 'qlearning';
                prevDiscreteState = null;
                prevState = null;
                prevAction = null;
                engine.reset();
                updateHUD();
                overlayMain.textContent = 'SYSTEM READY';
                overlaySub.textContent = 'move mouse or touch to play';
            });
    }
})();
