// ========== LANDER UI ==========
// Connects LanderEngine to the RL agents: pretrained weights, watch / auto-train
// modes, human override, actor-critic visualisation, localStorage persistence.
//
// Two modes:
//   WATCH       the current policy flies, nothing is learned (arrow keys take over)
//   AUTO-TRAIN  the agent flies at high speed and learns from every frame

(function () {
    'use strict';

    const canvas = document.getElementById('lander-canvas');
    if (!canvas) return;

    const engine = LanderEngine.create(canvas);
    const ALGOS = ['dqn', 'a2c', 'ppo'];
    const LEVELS = ['EASY', 'MEDIUM', 'HARD', 'FULL'];
    const STORE = 'lander_v2_';            // v2: new reward + network; old saves are ignored

    let agents = {};
    let pretrained = null;                 // serialized weights from weights/lander.json
    let currentAlgo = 'ppo';               // the strongest lander opens the show
    let level = 3;
    let ready = false, gameStarted = false, autoTraining = false;
    let trainTarget = 0, trainStart = 0, trainRafId = null;
    let prev = null;                       // { s, a } waiting for its reward
    let humanFlying = false;               // arrow key held this episode
    let recent = [];                       // rolling results for the progress readout

    // ---- DOM ----
    const $ = id => document.getElementById(id);
    const hudAlgo = $('hud-algo'), hudEpisode = $('hud-episode'), hudLandrate = $('hud-landrate');
    const hudEpsilon = $('hud-epsilon'), hudLevel = $('hud-level');
    const overlay = $('canvas-overlay');
    const overlayMain = overlay.querySelector('p'), overlaySub = overlay.querySelector('.overlay-sub');
    const trainBtn = $('train-btn'), trainSelect = $('train-episodes'), trainProgress = $('train-progress');
    const levelSelect = $('level-select'), brainBtn = $('brain-btn');
    const criticBar = $('critic-bar'), criticLabel = $('critic-value');
    const actionBars = [0, 1, 2, 3, 4, 5].map(i => $('action-bar-' + i));

    const algoInfo = {
        dqn: {
            title: 'Deep Q-Network (DQN)',
            text: 'The same algorithm that learned Pong, scaled up. A network (8→64→64→6, 5,126 parameters) estimates Q(s, a): the total future reward of each action. Double DQN, a replay buffer and a target network keep it stable. It explores with ε-greedy (ε = chance of a random action). The panel shows its Q-values as bars and V = max Q.'
        },
        a2c: {
            title: 'Advantage Actor-Critic (A2C)',
            text: 'Two networks. The Actor π(a|s) outputs action probabilities; the Critic V(s) predicts how much reward is still to come. Every 32 frames the actor compares what actually happened (the n-step return G) with what the critic expected: A = G − V(s). Better than expected → make that action more likely. No ε here: it explores by sampling from π. ~9,900 parameters.'
        },
        ppo: {
            title: 'Proximal Policy Optimization (PPO)',
            text: 'The algorithm behind RLHF for ChatGPT. Same actor-critic pair as A2C, but it collects 2,048 frames and reuses them for 4 epochs. So that one batch can’t wreck the policy, it clips the probability ratio π_new/π_old to [0.8, 1.2]. Advantages come from GAE (λ = 0.95). ~9,900 parameters.'
        }
    };

    // ---- persistence ----
    function save(name) {
        try { localStorage.setItem(STORE + name, JSON.stringify(agents[name].serialize())); } catch (e) { /* quota */ }
    }
    function loadSaved(name) {
        try {
            const raw = localStorage.getItem(STORE + name);
            return raw ? LanderRL.deserialize(JSON.parse(raw)) : null;
        } catch (e) { return null; }
    }
    function forget(name) { try { localStorage.removeItem(STORE + name); } catch (e) { /* ignore */ } }
    try { ALGOS.forEach(n => localStorage.removeItem('lander_rl_' + n)); } catch (e) { /* ignore */ }

    function fromPretrained(name) {
        if (!pretrained || !pretrained[name]) return null;
        const a = LanderRL.deserialize(pretrained[name]);
        a.episodes = 0; a.landings = 0; a.totalGames = 0;
        return a;
    }

    function blankAgent(name) {
        const a = LanderRL.create(name);
        a.blank = true;
        return a;
    }

    // ---- HUD ----
    function updateHUD() {
        const a = agents[currentAlgo];
        if (!a) return;
        hudAlgo.textContent = currentAlgo.toUpperCase();
        hudEpisode.textContent = a.episodes;
        hudLandrate.textContent = a.totalGames > 0 ? Math.round(a.landings / a.totalGames * 100) : 0;
        hudEpsilon.textContent = a.epsilon !== undefined ? a.epsilon.toFixed(2) : '—';
        hudLevel.textContent = LEVELS[level];
        if (brainBtn) {
            brainBtn.textContent = a.blank ? 'LOAD PRETRAINED' : 'BLANK BRAIN';
            brainBtn.disabled = autoTraining || (a.blank && !pretrained);
        }
    }

    function updateInfoCard() {
        $('algo-info-title').textContent = algoInfo[currentAlgo].title;
        $('algo-info-text').textContent = algoInfo[currentAlgo].text;
    }

    // Critic meter + action bars (DQN shows Q-values, A2C/PPO show π and V)
    function updateACVisualization(state) {
        const a = agents[currentAlgo];
        if (!a || !state) return;
        const value = a.getValue(state);
        const norm = Math.max(0, Math.min(100, (value + 15) / 40 * 100));
        criticBar.style.height = norm + '%';
        criticBar.dataset.level = norm < 33 ? 'low' : norm < 66 ? 'mid' : 'high';
        criticLabel.textContent = value.toFixed(1);

        const probs = a.getActionProbs(state);
        const maxP = Math.max.apply(null, probs);
        for (let i = 0; i < 6; i++) {
            const pct = Math.round(probs[i] * 100);
            actionBars[i].style.width = pct + '%';
            actionBars[i].textContent = pct > 5 ? pct + '%' : '';
            actionBars[i].classList.toggle('top-action', probs[i] === maxP && maxP > 0.2);
        }
    }

    // ---- episode loop ----
    function newEpisode(lv) {
        engine.setWindEnabled(lv >= 3);
        engine.generateTerrain();
        engine.spawnLander(lv);
        prev = null;
        humanFlying = false;
    }

    engine.setOnStepDone(function (state, reward, done) {
        const a = agents[currentAlgo];
        // Learn only while auto-training; watching shows the current policy as is
        if (autoTraining && prev) a.observe(prev.s, prev.a, reward, state, done);
        if (done) { prev = null; return; }

        let action = a.act(state);
        const key = engine.getKeyboardAction();
        if (!autoTraining && key !== 0) { action = key; humanFlying = true; }
        engine.setAction(action);
        prev = { s: state, a: action };
        if (!autoTraining) updateACVisualization(state);
    });

    engine.setOnEpisodeEnd(function (result) {
        const a = agents[currentAlgo];
        if (!humanFlying) {
            a.endEpisode(result);
            recent.push(result === 'landed');
            if (recent.length > 50) recent.shift();
        }
        if (autoTraining) {
            // Train on a mix of every level up to the selected one
            newEpisode(Math.floor(Math.random() * (level + 1)));
            if (a.episodes % 25 === 0) save(currentAlgo);
        } else {
            newEpisode(level);
            updateHUD();
        }
    });

    // ---- auto-train ----
    const STEPS_PER_FRAME = 300;

    function autoTrainFrame() {
        const a = agents[currentAlgo];
        for (let i = 0; i < STEPS_PER_FRAME; i++) engine.stepAgent();
        engine.render();
        updateACVisualization(engine.getState());
        const done = a.episodes - trainStart;
        const rate = recent.length ? Math.round(recent.filter(Boolean).length / recent.length * 100) : 0;
        trainProgress.textContent = done + '/' + trainTarget + '  (' + rate + '% land)';
        updateHUD();
        if (done >= trainTarget) { stopAutoTrain(); return; }
        trainRafId = requestAnimationFrame(autoTrainFrame);
    }

    function setLocked(locked) {
        trainSelect.disabled = locked;
        if (levelSelect) levelSelect.disabled = locked;
        if (brainBtn) brainBtn.disabled = locked;
        document.querySelectorAll('.algo-tab').forEach(t => { t.disabled = locked; });
    }

    function startAutoTrain() {
        if (!ready) return;
        if (autoTraining) { stopAutoTrain(); return; }
        hideOverlay();
        engine.stop();
        autoTraining = true;
        trainTarget = parseInt(trainSelect.value, 10);
        trainStart = agents[currentAlgo].episodes;
        recent = [];
        trainBtn.innerHTML = '<i class="fas fa-stop"></i> STOP';
        trainBtn.classList.add('training');
        setLocked(true);
        newEpisode(Math.floor(Math.random() * (level + 1)));
        trainRafId = requestAnimationFrame(autoTrainFrame);
    }

    function stopAutoTrain() {
        autoTraining = false;
        if (trainRafId) { cancelAnimationFrame(trainRafId); trainRafId = null; }
        trainBtn.innerHTML = '<i class="fas fa-bolt"></i> AUTO-TRAIN';
        trainBtn.classList.remove('training');
        setLocked(false);
        trainProgress.textContent = '';
        save(currentAlgo);
        updateHUD();
        newEpisode(level);
        engine.start(level);
    }

    trainBtn.addEventListener('click', startAutoTrain);

    // ---- algorithm tabs ----
    document.querySelectorAll('.algo-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            const algo = this.dataset.algo;
            if (!ready || algo === currentAlgo) return;
            if (autoTraining) stopAutoTrain();
            document.querySelectorAll('.algo-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            currentAlgo = algo;
            recent = [];
            newEpisode(level);
            updateHUD();
            updateInfoCard();
        });
    });

    // ---- level picker ----
    if (levelSelect) {
        levelSelect.value = String(level);
        levelSelect.addEventListener('change', function () {
            level = parseInt(this.value, 10) || 0;
            newEpisode(level);
            updateHUD();
        });
    }

    // ---- blank brain <-> pretrained ----
    if (brainBtn) {
        brainBtn.addEventListener('click', function () {
            if (!ready || autoTraining) return;
            const a = agents[currentAlgo];
            agents[currentAlgo] = a.blank ? (fromPretrained(currentAlgo) || a) : blankAgent(currentAlgo);
            forget(currentAlgo);
            if (agents[currentAlgo].blank) save(currentAlgo);
            recent = [];
            newEpisode(level);
            updateHUD();
        });
    }

    // ---- start ----
    function hideOverlay() {
        if (gameStarted) return;
        gameStarted = true;
        overlay.classList.add('hidden');
    }

    function startGame() {
        if (!ready || gameStarted) return;
        hideOverlay();
        newEpisode(level);
        engine.start(level);
        updateHUD();
    }

    canvas.addEventListener('click', startGame);
    canvas.addEventListener('touchstart', startGame);
    document.addEventListener('keydown', function (e) {
        if (['ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) startGame();
    });

    // ---- boot: load pretrained weights (trained offline by tools/lab-train.js) ----
    function boot(weights) {
        pretrained = weights;
        ALGOS.forEach(function (name) {
            agents[name] = loadSaved(name) || fromPretrained(name) || blankAgent(name);
        });
        ready = true;
        newEpisode(level);
        engine.render();
        updateHUD();
        updateInfoCard();
        overlayMain.textContent = pretrained ? 'PRETRAINED AGENTS LOADED' : 'BLANK AGENTS — HIT AUTO-TRAIN';
        overlaySub.textContent = 'click or press ↑ to watch · hold the arrow keys to fly it yourself';
    }

    overlayMain.textContent = 'LOADING WEIGHTS...';
    overlaySub.textContent = '';
    fetch('weights/lander.json')
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
        .then(boot);
})();
