// ========== PONG UI ==========
// Connects PongEngine to the RL agents: pretrained weights, live learning while
// you play, auto-train against a scripted bot, localStorage persistence.

(function () {
    'use strict';

    const canvas = document.getElementById('pong-canvas');
    if (!canvas) return;

    const engine = PongEngine.create(canvas);
    const ALGOS = ['qlearning', 'dqn', 'reinforce'];
    const STORE = 'pong_v2_';               // v2: new networks; old saves are ignored

    let agents = {};
    let pretrained = null;
    let currentAlgo = 'qlearning';
    let ready = false, gameStarted = false, autoTraining = false;
    let trainTarget = 0, trainStart = 0, trainRafId = null;
    let prev = null;                        // { obs, a } waiting for its reward

    const $ = id => document.getElementById(id);
    const hudAlgo = $('hud-algo'), hudEpisode = $('hud-episode'), hudWinrate = $('hud-winrate');
    const hudEpsilon = $('hud-epsilon'), hudBot = $('hud-bot');
    const overlay = $('canvas-overlay');
    const overlayMain = overlay.querySelector('p'), overlaySub = overlay.querySelector('.overlay-sub');
    const trainBtn = $('train-btn'), trainSelect = $('train-episodes'), trainProgress = $('train-progress');
    const brainBtn = $('brain-btn');

    const algoInfo = {
        qlearning: {
            title: 'Q-Learning',
            text: 'The simplest RL algorithm here. It chops the game into 24,000 discrete states and keeps a lookup table of Q(s, a) for UP / STAY / DOWN. Every frame it nudges one entry toward r + γ·max Q(s′). It explores with ε-greedy: ε is the chance of a random move. It keeps learning while you play.'
        },
        dqn: {
            title: 'Deep Q-Network (DQN)',
            text: 'Instead of a table, a tiny network (8 inputs → 48 hidden → 3 outputs, 579 parameters) estimates the Q-values, so similar states share what they learned. It stores frames in a replay buffer and trains on a random mini-batch every 4 frames; a separate target network keeps the targets from chasing themselves.'
        },
        reinforce: {
            title: 'REINFORCE (Policy Gradient)',
            text: 'Instead of valuing actions, it learns the policy directly: a probability for each move, and it explores by sampling from it. When a point ends it computes the discounted return of every move in that rally, and after 5 points it makes the moves with above-average returns more likely. The ancestor of PPO.'
        }
    };

    // ---- persistence ----
    function save(name) {
        try { localStorage.setItem(STORE + name, JSON.stringify(agents[name].serialize())); } catch (e) { /* quota */ }
    }
    function loadSaved(name) {
        try {
            const raw = localStorage.getItem(STORE + name);
            return raw ? PongRL.deserialize(JSON.parse(raw)) : null;
        } catch (e) { return null; }
    }
    function forget(name) { try { localStorage.removeItem(STORE + name); } catch (e) { /* ignore */ } }
    try { ALGOS.forEach(n => localStorage.removeItem('pong_rl_' + n)); } catch (e) { /* ignore */ }

    function fromPretrained(name) {
        if (!pretrained || !pretrained[name]) return null;
        const a = PongRL.deserialize(pretrained[name]);
        a.episodes = 0; a.wins = 0; a.totalGames = 0;
        return a;
    }
    function blankAgent(name) {
        const a = PongRL.create(name);
        a.blank = true;
        return a;
    }

    // ---- HUD ----
    function updateHUD() {
        const a = agents[currentAlgo];
        if (!a) return;
        hudAlgo.textContent = currentAlgo === 'qlearning' ? 'Q-LEARNING' : currentAlgo.toUpperCase();
        hudEpisode.textContent = a.episodes;
        hudWinrate.textContent = a.totalGames > 0 ? Math.round(a.wins / a.totalGames * 100) : 0;
        hudEpsilon.textContent = a.epsilon !== undefined ? a.epsilon.toFixed(2) : '—';
        hudBot.textContent = autoTraining ? Math.round(botStrength() * 100) + '%' : 'YOU';
        if (brainBtn) {
            brainBtn.textContent = a.blank ? 'LOAD PRETRAINED' : 'BLANK BRAIN';
            brainBtn.disabled = autoTraining || (a.blank && !pretrained);
        }
    }

    function updateInfoCard() {
        $('algo-info-title').textContent = algoInfo[currentAlgo].title;
        $('algo-info-text').textContent = algoInfo[currentAlgo].text;
    }

    // ---- engine callbacks: the AI learns from every frame, also while you play ----
    engine.setOnStepDone(function (s, d, reward, done) {
        const a = agents[currentAlgo];
        const obs = { s, d };
        const terminal = done || Math.abs(reward) >= 1;   // a point ends the rally
        if (prev) a.observe(prev.obs, prev.a, reward, obs, terminal);
        const action = a.act(obs);
        engine.setAIAction(action);
        prev = terminal ? null : { obs, a: action };
    });

    engine.setOnRoundEnd(function (winner) {
        const a = agents[currentAlgo];
        a.endEpisode(winner);
        recent.push(winner === 'ai');
        if (recent.length > ROLLING_WINDOW) recent.shift();
        if (!autoTraining) { save(currentAlgo); updateHUD(); }
        else if (a.episodes % 10 === 0) save(currentAlgo);
        prev = null;
    });

    // ---- auto-train: a scripted bot plays your side at high speed ----
    const STEPS_PER_FRAME = 200;
    const ROLLING_WINDOW = 20;
    let recent = [];

    // Bot opponent: strength 0 = slow and noisy, 1 = near perfect
    function botMovePlayer(strength) {
        const ball = engine.getBall(), H = engine.getH();
        const target = ball.y + (Math.random() - 0.5) * (1 - strength) * 60;
        const pY = engine.getState()[5] * H;
        const diff = target - pY;
        engine.setPlayerY(pY + Math.sign(diff) * Math.min(Math.abs(diff), 1.5 + strength * 4.5));
    }

    // Curriculum: the bot gets stronger as the AI's rolling win rate rises
    function botStrength() {
        const wr = recent.length ? recent.filter(Boolean).length / recent.length : 0;
        if (wr < 0.15) return 0.1;
        if (wr < 0.30) return 0.25;
        if (wr < 0.45) return 0.4;
        if (wr < 0.60) return 0.55;
        if (wr < 0.75) return 0.7;
        return 0.85;
    }

    function autoTrainFrame() {
        const a = agents[currentAlgo];
        const strength = botStrength();
        for (let i = 0; i < STEPS_PER_FRAME; i++) {
            botMovePlayer(strength);
            engine.step();
        }
        engine.render();
        const done = a.episodes - trainStart;
        const wr = recent.length ? Math.round(recent.filter(Boolean).length / recent.length * 100) : 0;
        trainProgress.textContent = done + '/' + trainTarget + '  (' + wr + '% win)';
        updateHUD();
        if (done >= trainTarget) { stopAutoTrain(); return; }
        trainRafId = requestAnimationFrame(autoTrainFrame);
    }

    function setLocked(locked) {
        trainSelect.disabled = locked;
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
        prev = null;
        trainBtn.innerHTML = '<i class="fas fa-stop"></i> STOP';
        trainBtn.classList.add('training');
        setLocked(true);
        engine.reset();
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
        prev = null;
        engine.reset();
        engine.start();
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
            prev = null;
            recent = [];
            engine.reset();
            updateHUD();
            updateInfoCard();
        });
    });

    // ---- blank brain <-> pretrained ----
    if (brainBtn) {
        brainBtn.addEventListener('click', function () {
            if (!ready || autoTraining) return;
            const a = agents[currentAlgo];
            agents[currentAlgo] = a.blank ? (fromPretrained(currentAlgo) || a) : blankAgent(currentAlgo);
            forget(currentAlgo);
            if (agents[currentAlgo].blank) save(currentAlgo);
            prev = null;
            recent = [];
            engine.reset();
            updateHUD();
        });
    }

    // ---- start on first interaction ----
    function hideOverlay() {
        if (gameStarted) return;
        gameStarted = true;
        overlay.classList.add('hidden');
    }

    function startGame() {
        if (!ready || gameStarted) return;
        hideOverlay();
        engine.start();
        updateHUD();
    }

    canvas.addEventListener('mousemove', startGame);
    canvas.addEventListener('touchstart', startGame);
    document.addEventListener('keydown', function (e) {
        if (['ArrowUp', 'ArrowDown', 'w', 's'].includes(e.key)) startGame();
    });

    // ---- boot: load pretrained weights (trained offline by tools/lab-train.js) ----
    function boot(weights) {
        pretrained = weights;
        ALGOS.forEach(function (name) {
            agents[name] = loadSaved(name) || fromPretrained(name) || blankAgent(name);
        });
        ready = true;
        engine.render();
        updateHUD();
        updateInfoCard();
        overlayMain.textContent = 'MOVE YOUR MOUSE TO PLAY';
        overlaySub.textContent = 'or arrow keys / W,S / touch';
    }

    overlayMain.textContent = 'LOADING WEIGHTS...';
    overlaySub.textContent = '';
    fetch('weights/pong.json')
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
        .then(boot);
})();
