// ========== LANDER UI ==========
// Connects LanderEngine to RL agents, manages HUD, auto-train, curriculum,
// actor-critic visualization, localStorage persistence, warmup boot

(function () {
    'use strict';

    const canvas = document.getElementById('lander-canvas');
    if (!canvas) return;

    const engine = LanderEngine.create(canvas);

    // ---- Agents ----
    const agents = {
        dqn: loadAgent('dqn') || new LanderRL.DQNAgent(),
        a2c: loadAgent('a2c') || new LanderRL.A2CAgent(),
        ppo: loadAgent('ppo') || new LanderRL.PPOAgent()
    };

    let currentAlgo = 'dqn';
    let prevState = null;
    let prevAction = null;
    let gameStarted = false;
    let autoTraining = false;
    let trainTarget = 0;
    let trainStart = 0;
    let trainRafId = null;
    let curriculumLevel = 0;

    // ---- HUD elements ----
    const hudAlgo = document.getElementById('hud-algo');
    const hudEpisode = document.getElementById('hud-episode');
    const hudLandrate = document.getElementById('hud-landrate');
    const hudEpsilon = document.getElementById('hud-epsilon');
    const hudLevel = document.getElementById('hud-level');
    const overlay = document.getElementById('canvas-overlay');

    // ---- Actor-Critic visualization elements ----
    const acPanel = document.getElementById('ac-panel');
    const criticBar = document.getElementById('critic-bar');
    const criticLabel = document.getElementById('critic-value');
    const actionBars = [];
    for (let i = 0; i < 6; i++) {
        actionBars.push(document.getElementById('action-bar-' + i));
    }

    // ---- Algorithm info descriptions ----
    const algoInfo = {
        dqn: {
            title: 'Deep Q-Network (DQN)',
            text: 'The same algorithm that learned Pong. A single neural network (8\u219248\u21926) estimates Q-values for each action. Uses Double DQN with a replay buffer and target network for stability. It\u2019s a solid baseline that visitors already know. 726 parameters. Expect landing improvement around 80\u2013120 episodes.'
        },
        a2c: {
            title: 'Advantage Actor-Critic (A2C)',
            text: 'The core teaching algorithm. TWO separate networks: an Actor (\u03C0) that outputs a probability distribution over actions, and a Critic (V) that estimates how good the current state is. The advantage A = r + \u03B3V(s\u2019) \u2013 V(s) tells the actor "was this action better or worse than expected?" This is the foundation of modern RL \u2014 from RLHF for LLMs to robotic control. 807 parameters across both networks.'
        },
        ppo: {
            title: 'Proximal Policy Optimization (PPO)',
            text: 'The algorithm behind ChatGPT\u2019s RLHF and most modern RL systems. Same actor-critic architecture as A2C, but instead of single-step updates, it collects trajectories and runs multiple optimization epochs with a clipped importance ratio: clip(\u03C0_new/\u03C0_old, 1\u00B10.2) \u00D7 advantage. This prevents catastrophic policy updates. Uses GAE (\u03BB=0.95) for smoother advantage estimates. 807 parameters. Typically the most stable learner.'
        }
    };

    // ---- Update HUD ----
    function updateHUD() {
        const a = agents[currentAlgo];
        hudAlgo.textContent = currentAlgo.toUpperCase();
        hudEpisode.textContent = a.episodes;
        const lr = a.totalGames > 0 ? Math.round(a.landings / a.totalGames * 100) : 0;
        hudLandrate.textContent = lr;
        const eps = a.epsilon !== undefined ? a.epsilon.toFixed(2) : '\u2014';
        hudEpsilon.textContent = eps;
        hudLevel.textContent = ['EASY', 'MEDIUM', 'HARD', 'FULL'][curriculumLevel] || 'EASY';
    }

    // ---- Update info card ----
    function updateInfoCard() {
        const info = algoInfo[currentAlgo];
        document.getElementById('algo-info-title').textContent = info.title;
        document.getElementById('algo-info-text').textContent = info.text;
    }

    // ---- Show/hide AC panel ----
    function updateACPanelVisibility() {
        if (currentAlgo === 'a2c' || currentAlgo === 'ppo') {
            acPanel.classList.remove('hidden');
        } else {
            acPanel.classList.add('hidden');
        }
    }

    // ---- Update AC visualization ----
    function updateACVisualization(state) {
        if (currentAlgo !== 'a2c' && currentAlgo !== 'ppo') return;
        if (!state) return;

        const a = agents[currentAlgo];

        // Critic value meter
        const value = a.getValue(state);
        // Map value to 0-100 range (roughly -100 to +100 reward range)
        const normV = Math.max(0, Math.min(100, (value + 50) / 1.5));
        criticBar.style.height = normV + '%';

        // Color: red (low) -> yellow (mid) -> green (high)
        let color;
        if (normV < 33) color = '#ff3333';
        else if (normV < 66) color = '#ffcc00';
        else color = '#39ff14';
        criticBar.style.background = color;
        criticBar.style.boxShadow = '0 0 8px ' + color;
        criticLabel.textContent = value.toFixed(1);

        // Actor action probabilities
        const probs = a.getActionProbs(state);
        const maxProb = Math.max(...probs);
        for (let i = 0; i < 6; i++) {
            const pct = Math.round(probs[i] * 100);
            actionBars[i].style.width = pct + '%';
            actionBars[i].textContent = pct > 5 ? pct + '%' : '';
            if (probs[i] === maxProb && maxProb > 0.2) {
                actionBars[i].classList.add('top-action');
            } else {
                actionBars[i].classList.remove('top-action');
            }
        }
    }

    // ---- localStorage persistence ----
    function saveAgent(name) {
        try {
            const data = agents[name].serialize();
            localStorage.setItem('lander_rl_' + name, JSON.stringify(data));
        } catch (e) { /* quota exceeded */ }
    }

    function loadAgent(name) {
        try {
            const raw = localStorage.getItem('lander_rl_' + name);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (name === 'dqn') return LanderRL.DQNAgent.deserialize(data);
            if (name === 'a2c') return LanderRL.A2CAgent.deserialize(data);
            if (name === 'ppo') return LanderRL.PPOAgent.deserialize(data);
        } catch (e) { return null; }
        return null;
    }

    // ---- Rolling landing rate for curriculum ----
    var recentResults = [];
    var ROLLING_WINDOW = 20;

    function rollingLandRate() {
        if (recentResults.length === 0) return 0;
        var lands = 0;
        for (var i = 0; i < recentResults.length; i++) {
            if (recentResults[i]) lands++;
        }
        return lands / recentResults.length;
    }

    function updateCurriculum() {
        var rate = rollingLandRate();
        if (rate > 0.6 && curriculumLevel < 3) {
            curriculumLevel++;
            recentResults = [];
        }
        // Enable wind at level 3
        engine.setWindEnabled(curriculumLevel >= 3);
    }

    // ---- Engine callbacks ----
    engine.setOnStepDone(function (state, reward, done, result) {
        var a = agents[currentAlgo];

        if (currentAlgo === 'dqn') {
            if (prevAction !== null && prevState !== null) {
                a.storeTransition(prevState, prevAction, reward, state, done);
            }
            var action = a.chooseAction(state);
            engine.setAction(action);
            prevState = state.slice();
            prevAction = action;
        } else if (currentAlgo === 'a2c') {
            // A2C: per-step TD update
            if (prevState !== null && prevAction !== null) {
                a.update(prevState, prevAction, reward, state, done);
            }
            var action = a.chooseAction(state);
            engine.setAction(action);
            prevState = state.slice();
            prevAction = action;
        } else if (currentAlgo === 'ppo') {
            // PPO: store step for trajectory
            var action = a.chooseAction(state);
            a.storeStep(state, action, reward, done);
            engine.setAction(action);
            prevState = state.slice();
            prevAction = action;
        }

        // Update AC visualization (throttled during auto-train)
        if (!autoTraining && !warmingUp) {
            updateACVisualization(state);
        }
    });

    engine.setOnEpisodeEnd(function (result) {
        var a = agents[currentAlgo];
        a.onEpisodeEnd(result);

        recentResults.push(result === 'landed');
        if (recentResults.length > ROLLING_WINDOW) recentResults.shift();

        if (autoTraining || warmingUp) {
            updateCurriculum();
        }

        // Always reset for next episode
        engine.generateTerrain();
        engine.spawnLander(curriculumLevel);

        if (!autoTraining && !warmingUp) {
            saveAgent(currentAlgo);
            updateHUD();
        } else if (a.episodes % 10 === 0) {
            saveAgent(currentAlgo);
        }

        prevState = null;
        prevAction = null;
    });

    // ---- Auto-train ----
    var trainBtn = document.getElementById('train-btn');
    var trainSelect = document.getElementById('train-episodes');
    var trainProgress = document.getElementById('train-progress');
    var STEPS_PER_FRAME = 200;

    function autoTrainFrame() {
        var a = agents[currentAlgo];
        for (var i = 0; i < STEPS_PER_FRAME; i++) {
            engine.step();
            // Check if episode ended (engine callbacks handle resets during auto-train)
            // Auto-reset on episode end
            var l = engine.getLander();
            if (l.y > engine.getH() + 50 || l.x < -50 || l.x > engine.getW() + 50) {
                // Force end if somehow stuck
                break;
            }
        }
        engine.render();

        // Update AC visualization periodically during auto-train
        var state = engine.getState();
        updateACVisualization(state);

        var done = a.episodes - trainStart;
        var lr = Math.round(rollingLandRate() * 100);
        trainProgress.textContent = done + '/' + trainTarget + '  (' + lr + '% land)';
        updateHUD();

        if (done >= trainTarget) {
            stopAutoTrain();
            return;
        }
        trainRafId = requestAnimationFrame(autoTrainFrame);
    }

    function startAutoTrain() {
        if (autoTraining) { stopAutoTrain(); return; }

        if (!gameStarted) {
            gameStarted = true;
            overlay.classList.add('hidden');
        }
        engine.stop();

        autoTraining = true;
        trainTarget = parseInt(trainSelect.value, 10);
        trainStart = agents[currentAlgo].episodes;
        trainBtn.innerHTML = '<i class="fas fa-stop"></i> STOP';
        trainBtn.classList.add('training');
        trainSelect.disabled = true;
        document.querySelectorAll('.algo-tab').forEach(function (t) { t.disabled = true; });

        engine.generateTerrain();
        engine.spawnLander(curriculumLevel);
        prevState = null;
        prevAction = null;
        recentResults = [];

        trainRafId = requestAnimationFrame(autoTrainFrame);
    }

    function stopAutoTrain() {
        autoTraining = false;
        if (trainRafId) { cancelAnimationFrame(trainRafId); trainRafId = null; }
        trainBtn.innerHTML = '<i class="fas fa-bolt"></i> AUTO-TRAIN';
        trainBtn.classList.remove('training');
        trainSelect.disabled = false;
        document.querySelectorAll('.algo-tab').forEach(function (t) { t.disabled = false; });
        trainProgress.textContent = '';
        saveAgent(currentAlgo);
        updateHUD();

        engine.generateTerrain();
        engine.spawnLander(curriculumLevel);
        engine.start(curriculumLevel);
    }

    trainBtn.addEventListener('click', startAutoTrain);

    // ---- Algorithm tab switching ----
    document.querySelectorAll('.algo-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            var algo = this.dataset.algo;
            if (algo === currentAlgo) return;
            if (autoTraining) stopAutoTrain();

            document.querySelectorAll('.algo-tab').forEach(function (t) { t.classList.remove('active'); });
            this.classList.add('active');

            currentAlgo = algo;
            prevState = null;
            prevAction = null;
            recentResults = [];
            curriculumLevel = 0;

            engine.generateTerrain();
            engine.spawnLander(0);
            updateHUD();
            updateInfoCard();
            updateACPanelVisibility();
        });
    });

    // ---- Start game on first interaction ----
    function startGame() {
        if (gameStarted) return;
        gameStarted = true;
        overlay.classList.add('hidden');
        engine.generateTerrain();
        engine.spawnLander(curriculumLevel);
        engine.start(curriculumLevel);
        updateHUD();
    }

    canvas.addEventListener('click', startGame, { once: true });
    canvas.addEventListener('touchstart', startGame, { once: true });
    document.addEventListener('keydown', function onKey(e) {
        if (['ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            startGame();
            document.removeEventListener('keydown', onKey);
        }
    });

    // Keyboard action override during human play (when not auto-training)
    // During normal play, let human and AI both influence — AI runs through callbacks,
    // but if user presses a key, that takes priority
    (function () {
        var humanOverride = false;
        document.addEventListener('keydown', function (e) {
            if (autoTraining || warmingUp) return;
            if (['ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                humanOverride = true;
                engine.setAction(engine.getKeyboardAction());
            }
        });
        document.addEventListener('keyup', function () {
            humanOverride = false;
        });
    })();

    // Initial state
    updateHUD();
    updateInfoCard();
    updateACPanelVisibility();

    // ---- Boot sequence: warmup training ----
    var overlayMain = overlay.querySelector('p');
    var overlaySub = overlay.querySelector('.overlay-sub');
    var warmingUp = false;

    var WARMUP_EPISODES = { dqn: 150, a2c: 100, ppo: 80 };
    var WARMUP_BUDGET_MS = 8;

    var bootMessages = [
        'INITIALIZING NEURAL NETWORKS...',
        'LOADING ACTOR-CRITIC ARCHITECTURE...',
        'CALIBRATING REWARD SIGNALS...',
        'TRAINING DQN BASELINE...',
        'TRAINING A2C ACTOR-CRITIC...',
        'TRAINING PPO AGENT...',
        'COMPUTING ADVANTAGE ESTIMATES...',
        'CLIPPING POLICY RATIOS...',
        'FINALIZING WEIGHT MATRICES...',
        'AGENTS READY.'
    ];

    function warmupAgentAsync(algoName) {
        return new Promise(function (resolve) {
            var a = agents[algoName];
            var target = WARMUP_EPISODES[algoName] || 0;
            if (a.episodes >= target) { resolve(); return; }

            currentAlgo = algoName;
            prevState = null;
            prevAction = null;
            curriculumLevel = 0;
            recentResults = [];
            engine.generateTerrain();
            engine.spawnLander(0);

            // Aggressive hyperparameters for fast convergence
            var origEpsilon = a.epsilon;
            var origDecay = a.epsilonDecay;
            a.epsilon = 0.5;
            if (a.epsilonDecay !== undefined) a.epsilonDecay = 0.97;

            function chunk() {
                var deadline = performance.now() + WARMUP_BUDGET_MS;
                while (a.episodes < target && performance.now() < deadline) {
                    engine.step();
                }

                var totalEps = WARMUP_EPISODES.dqn + WARMUP_EPISODES.a2c + WARMUP_EPISODES.ppo;
                var doneEps = Math.min(agents.dqn.episodes, WARMUP_EPISODES.dqn)
                    + Math.min(agents.a2c.episodes, WARMUP_EPISODES.a2c)
                    + Math.min(agents.ppo.episodes, WARMUP_EPISODES.ppo);
                var pct = Math.min(100, Math.round(doneEps / totalEps * 100));
                var msgIdx = Math.min(Math.floor(pct / 11), bootMessages.length - 1);
                overlayMain.textContent = bootMessages[msgIdx];
                overlaySub.textContent = '[ ' + pct + '% ]';

                if (a.episodes >= target) {
                    a.epsilonDecay = origDecay;
                    a.epsilon = 0.12;
                    a.landings = 0;
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

    var needsWarmup = ['dqn', 'a2c', 'ppo'].some(function (name) {
        return agents[name].episodes < (WARMUP_EPISODES[name] || 0);
    });

    if (needsWarmup) {
        warmingUp = true;
        overlayMain.textContent = bootMessages[0];
        overlaySub.textContent = '[ 0% ]';

        // Need terrain generated for warmup
        engine.generateTerrain();
        engine.spawnLander(0);

        warmupAgentAsync('dqn')
            .then(function () {
                engine.generateTerrain();
                engine.spawnLander(0);
                return warmupAgentAsync('a2c');
            })
            .then(function () {
                engine.generateTerrain();
                engine.spawnLander(0);
                return warmupAgentAsync('ppo');
            })
            .then(function () {
                warmingUp = false;
                currentAlgo = 'dqn';
                prevState = null;
                prevAction = null;
                curriculumLevel = 0;
                engine.generateTerrain();
                engine.spawnLander(0);
                engine.render();
                updateHUD();
                updateACPanelVisibility();
                overlayMain.textContent = 'SYSTEM READY';
                overlaySub.textContent = 'press arrow keys or click to begin';
            });
    } else {
        // Already trained — show initial render
        engine.generateTerrain();
        engine.spawnLander(0);
        engine.render();
    }
})();
