// ========== PONG RL AGENTS ==========
// Q-Learning (lookup table), DQN and REINFORCE on top of TinyNN (tiny-nn.js).
//
// Shared interface (an observation is { s: 8-D vector, d: discrete state id }):
//   act(obs)                          -> 0 = UP, 1 = STAY, 2 = DOWN
//   observe(obs, a, r, obs2, done)    -> learn from one transition
//   endEpisode(winner)                -> bookkeeping ('ai' or 'player')

const PongRL = (function () {
    'use strict';

    const NN = (typeof TinyNN !== 'undefined') ? TinyNN : require('./tiny-nn.js');
    const N_ACT = 3;

    function Stats(agent) { agent.episodes = 0; agent.wins = 0; agent.totalGames = 0; }
    function recordGame(agent, winner) {
        agent.episodes++;
        agent.totalGames++;
        if (winner === 'ai') agent.wins++;
    }

    // ========================================================
    // 1. Q-LEARNING: a table of Q(s, a) over 24,000 discrete states
    // ========================================================
    function QLearningAgent() {
        this.Q = {};
        this.lr = 0.15;
        this.gamma = 0.99;
        this.epsilon = 1.0;
        this.epsilonDecay = 0.97;   // per game
        this.epsilonMin = 0.03;
        Stats(this);
    }

    QLearningAgent.prototype.getQ = function (d) {
        if (!this.Q[d]) this.Q[d] = [0, 0, 0];
        return this.Q[d];
    };

    QLearningAgent.prototype.act = function (obs) {
        if (Math.random() < this.epsilon) return Math.floor(Math.random() * N_ACT);
        return NN.argmax(this.getQ(obs.d));
    };

    QLearningAgent.prototype.observe = function (obs, a, r, obs2, done) {
        const q = this.getQ(obs.d);
        const maxNext = done ? 0 : Math.max.apply(null, this.getQ(obs2.d));
        q[a] += this.lr * (r + this.gamma * maxNext - q[a]);   // TD update
    };

    QLearningAgent.prototype.endEpisode = function (winner) {
        recordGame(this, winner);
        this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
    };

    QLearningAgent.prototype.serialize = function () {
        const Q = {};
        for (const k in this.Q) Q[k] = this.Q[k].map(v => Math.round(v * 1000) / 1000);
        return { algo: 'qlearning', Q, epsilon: this.epsilon,
                 episodes: this.episodes, wins: this.wins, totalGames: this.totalGames };
    };
    QLearningAgent.deserialize = function (d) {
        const a = new QLearningAgent();
        a.Q = d.Q || {};
        a.epsilon = d.epsilon !== undefined ? d.epsilon : 1.0;
        a.episodes = d.episodes || 0; a.wins = d.wins || 0; a.totalGames = d.totalGames || 0;
        return a;
    };

    // ========================================================
    // 2. DQN: a small network replaces the table
    // ========================================================
    function DQNAgent() {
        this.net = new NN.MLP([8, 48, N_ACT]);        // 8×48 + 48 + 48×3 + 3 = 579 params
        this.targetNet = new NN.MLP([8, 48, N_ACT]);
        this.targetNet.copyFrom(this.net);
        this.gamma = 0.99;
        this.lr = 1e-3;
        this.batchSize = 32;
        this.bufferMax = 30000;
        this.trainEvery = 1;           // one mini-batch per decision (= every 4 frames)
        this.targetSyncSteps = 1000;
        this.learnStart = 1000;
        this.epsilon = 1.0;
        this.epsilonMin = 0.03;
        this.epsilonDecay = 0.9998;   // per decision
        this.buffer = [];
        this.bufPos = 0;
        this.stepCount = 0;
        this.repeat = 4;
        this.pending = null;
        Stats(this);
    }

    DQNAgent.prototype.act = function (obs) {
        if (this.pending) return this.pending.a;     // still repeating the last action
        if (Math.random() < this.epsilon) return Math.floor(Math.random() * N_ACT);
        return NN.argmax(this.net.predict(obs.s));
    };

    // Action repeat (as in the Atari DQN): one decision is held for `repeat`
    // frames, so the agent sees the effect of a move instead of a 5 px nudge.
    DQNAgent.prototype.observe = function (obs, a, r, obs2, done) {
        if (!this.pending) this.pending = { s: obs.s, a, r: 0, n: 0 };
        const p = this.pending;
        p.r += Math.pow(this.gamma, p.n) * r;
        p.n++;
        if (p.n < this.repeat && !done) return;
        this.pending = null;
        const t = { s: p.s, a: p.a, r: p.r, s2: obs2.s, done, discount: Math.pow(this.gamma, p.n) };
        if (this.buffer.length < this.bufferMax) this.buffer.push(t);
        else this.buffer[this.bufPos] = t;
        this.bufPos = (this.bufPos + 1) % this.bufferMax;
        this.stepCount++;
        this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
        if (this.buffer.length >= this.learnStart && this.stepCount % this.trainEvery === 0) this.train();
        if (this.stepCount % this.targetSyncSteps === 0) this.targetNet.copyFrom(this.net);
    };

    DQNAgent.prototype.train = function () {
        const buf = this.buffer;
        for (let n = 0; n < this.batchSize; n++) {
            const { s, a, r, s2, done, discount } = buf[Math.floor(Math.random() * buf.length)];
            let target = r;
            if (!done) {
                const best = NN.argmax(this.net.predict(s2));          // Double DQN
                target += discount * this.targetNet.predict(s2)[best];
            }
            const { out, acts } = this.net.forward(s);
            const dOut = new Float64Array(N_ACT);
            dOut[a] = Math.max(-1, Math.min(1, out[a] - target));     // Huber loss gradient
            this.net.backward(acts, dOut);
        }
        this.net.step(this.lr, 10);
    };

    DQNAgent.prototype.endEpisode = function (winner) { recordGame(this, winner); };

    DQNAgent.prototype.serialize = function () {
        return { algo: 'dqn', net: this.net.serialize(), epsilon: this.epsilon, stepCount: this.stepCount,
                 episodes: this.episodes, wins: this.wins, totalGames: this.totalGames };
    };
    DQNAgent.deserialize = function (d) {
        const a = new DQNAgent();
        a.net = NN.MLP.deserialize(d.net);
        a.targetNet = NN.MLP.deserialize(d.net);
        a.epsilon = d.epsilon !== undefined ? d.epsilon : a.epsilonMin;
        a.stepCount = d.stepCount || 0;
        a.episodes = d.episodes || 0; a.wins = d.wins || 0; a.totalGames = d.totalGames || 0;
        return a;
    };

    // ========================================================
    // 3. REINFORCE: policy gradient, one rally = one episode
    // ========================================================
    // Like Karpathy's "Pong from Pixels", each point is its own episode for the
    // return: credit for winning a point shouldn't leak into the next rally.
    function ReinforceAgent() {
        this.net = new NN.MLP([8, 48, N_ACT], 0.01);
        this.gamma = 0.99;
        this.lr = 1e-3;
        this.entropyCoef = 0.01;
        this.pointsPerUpdate = 5;
        this.rally = [];       // steps of the current point
        this.batch = [];       // finished rallies waiting for an update
        Stats(this);
    }

    ReinforceAgent.prototype.act = function (obs) {
        return NN.sample(NN.softmax(this.net.predict(obs.s)));
    };

    ReinforceAgent.prototype.observe = function (obs, a, r, obs2, done) {
        this.rally.push({ s: obs.s, a, r });
        // |r| >= 1 means a point was scored: the rally is over
        if (done || Math.abs(r) >= 1) {
            this.batch.push(this.rally);
            this.rally = [];
            if (this.batch.length >= this.pointsPerUpdate) this.update();
        }
    };

    ReinforceAgent.prototype.update = function () {
        // Discounted returns G_t for every step of every rally in the batch
        const steps = [];
        for (const rally of this.batch) {
            let G = 0;
            for (let t = rally.length - 1; t >= 0; t--) {
                G = rally[t].r + this.gamma * G;
                steps.push({ s: rally[t].s, a: rally[t].a, G });
            }
        }
        // Baseline: normalise the returns across the batch
        let mean = 0, sd = 0;
        for (const st of steps) mean += st.G;
        mean /= steps.length;
        for (const st of steps) sd += (st.G - mean) * (st.G - mean);
        sd = Math.sqrt(sd / steps.length) + 1e-8;
        for (const st of steps) {
            const { out, acts } = this.net.forward(st.s);
            const probs = NN.softmax(out);
            this.net.backward(acts, NN.policyGradLogits(probs, st.a, (st.G - mean) / sd, this.entropyCoef));
        }
        this.net.step(this.lr, 1);
        this.batch = [];
    };

    ReinforceAgent.prototype.endEpisode = function (winner) { recordGame(this, winner); };

    ReinforceAgent.prototype.serialize = function () {
        return { algo: 'reinforce', net: this.net.serialize(),
                 episodes: this.episodes, wins: this.wins, totalGames: this.totalGames };
    };
    ReinforceAgent.deserialize = function (d) {
        const a = new ReinforceAgent();
        a.net = NN.MLP.deserialize(d.net);
        a.episodes = d.episodes || 0; a.wins = d.wins || 0; a.totalGames = d.totalGames || 0;
        return a;
    };

    const Agents = { qlearning: QLearningAgent, dqn: DQNAgent, reinforce: ReinforceAgent };
    function create(algo) { return new Agents[algo](); }
    function deserialize(d) { return Agents[d.algo].deserialize(d); }

    return { QLearningAgent, DQNAgent, ReinforceAgent, create, deserialize };
})();

if (typeof module !== 'undefined') module.exports = PongRL;
