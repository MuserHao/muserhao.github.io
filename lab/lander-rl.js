// ========== LUNAR LANDER RL AGENTS ==========
// DQN, A2C (Advantage Actor-Critic) and PPO on top of TinyNN (tiny-nn.js).
//
// Every agent has the same interface, so the UI and the offline trainer drive
// them identically:
//   act(s)                     -> action index (samples / explores)
//   observe(s, a, r, s2, done) -> learn from one transition
//   endEpisode(result)         -> bookkeeping ('landed', 'crash', 'oob', 'timeout')
//   getActionProbs(s), getValue(s) for the visualisation panel

const LanderRL = (function () {
    'use strict';

    const NN = (typeof TinyNN !== 'undefined') ? TinyNN : require('./tiny-nn.js');
    const N_STATE = 8, N_ACT = 6, HIDDEN = [64, 64];

    function Stats(agent) {
        agent.episodes = 0;
        agent.landings = 0;
        agent.totalGames = 0;
    }
    function recordEpisode(agent, result) {
        agent.episodes++;
        agent.totalGames++;
        if (result === 'landed') agent.landings++;
    }

    // ========================================================
    // 1. DQN: Double DQN + replay buffer + target network
    // ========================================================
    function DQNAgent() {
        this.net = new NN.MLP([N_STATE].concat(HIDDEN, [N_ACT]));
        this.targetNet = new NN.MLP([N_STATE].concat(HIDDEN, [N_ACT]));
        this.targetNet.copyFrom(this.net);
        this.gamma = 0.99;
        this.lr = 5e-4;
        this.batchSize = 64;
        this.bufferMax = 50000;
        this.trainEvery = 1;           // one mini-batch per decision (= every 4 frames)
        this.targetSyncSteps = 1000;
        this.learnStart = 1000;
        this.epsilon = 1.0;
        this.epsilonMin = 0.02;
        this.epsilonDecay = 0.9998;     // per decision: ~1.0 -> 0.08 over 12.5K decisions
        this.buffer = [];
        this.bufPos = 0;
        this.stepCount = 0;
        this.repeat = 4;
        this.pending = null;
        Stats(this);
    }

    DQNAgent.prototype.act = function (s) {
        if (this.pending) return this.pending.a;     // still repeating the last action
        if (Math.random() < this.epsilon) return Math.floor(Math.random() * N_ACT);
        return NN.argmax(this.net.predict(s));
    };

    // Action repeat (as in the Atari DQN): one decision is held for `repeat`
    // frames, so each choice has a visible effect and episodes are shorter.
    DQNAgent.prototype.observe = function (s, a, r, s2, done) {
        if (!this.pending) this.pending = { s, a, r: 0, n: 0 };
        const p = this.pending;
        p.r += Math.pow(this.gamma, p.n) * r;
        p.n++;
        if (p.n < this.repeat && !done) return;
        this.pending = null;
        const t = { s: p.s, a: p.a, r: p.r, s2, done, discount: Math.pow(this.gamma, p.n) };
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
                // Double DQN: the online net picks the action, the target net scores it
                const best = NN.argmax(this.net.predict(s2));
                target += discount * this.targetNet.predict(s2)[best];
            }
            const { out, acts } = this.net.forward(s);
            const dOut = new Float64Array(N_ACT);
            dOut[a] = Math.max(-1, Math.min(1, out[a] - target)); // Huber loss gradient
            this.net.backward(acts, dOut);
        }
        this.net.step(this.lr, 10);
    };

    DQNAgent.prototype.endEpisode = function (result) { recordEpisode(this, result); };

    // Q-values shown as a softmax so they fit the same bar chart
    DQNAgent.prototype.getActionProbs = function (s) {
        const q = this.net.predict(s);
        return NN.softmax(Array.from(q, v => v * 2));
    };
    DQNAgent.prototype.getValue = function (s) {
        const q = this.net.predict(s);
        return q[NN.argmax(q)];
    };

    DQNAgent.prototype.serialize = function () {
        return { algo: 'dqn', net: this.net.serialize(), epsilon: this.epsilon, stepCount: this.stepCount,
                 episodes: this.episodes, landings: this.landings, totalGames: this.totalGames };
    };
    DQNAgent.deserialize = function (d) {
        const a = new DQNAgent();
        a.net = NN.MLP.deserialize(d.net);
        a.targetNet = NN.MLP.deserialize(d.net);
        a.epsilon = d.epsilon !== undefined ? d.epsilon : a.epsilonMin;
        a.stepCount = d.stepCount || 0;
        a.episodes = d.episodes || 0; a.landings = d.landings || 0; a.totalGames = d.totalGames || 0;
        return a;
    };

    // ========================================================
    // 2. A2C: Advantage Actor-Critic with n-step returns
    // ========================================================
    function A2CAgent() {
        this.actor = new NN.MLP([N_STATE].concat(HIDDEN, [N_ACT]), 0.01);
        this.critic = new NN.MLP([N_STATE].concat(HIDDEN, [1]));
        this.gamma = 0.99;
        this.nSteps = 32;
        this.actorLr = 3e-4;
        this.criticLr = 1e-3;
        this.entropyCoef = 0.01;
        this.batch = [];
        Stats(this);
    }

    A2CAgent.prototype.act = function (s) {
        return NN.sample(NN.softmax(this.actor.predict(s)));
    };

    A2CAgent.prototype.observe = function (s, a, r, s2, done) {
        this.batch.push({ s, a, r, s2, done });
        if (this.batch.length >= this.nSteps || done) this.update();
    };

    A2CAgent.prototype.update = function () {
        const B = this.batch, T = B.length;
        if (T === 0) return;
        // n-step return, bootstrapped from V(s_T) unless the episode ended
        const last = B[T - 1];
        let R = last.done ? 0 : this.critic.predict(last.s2)[0];
        const returns = new Float64Array(T);
        for (let t = T - 1; t >= 0; t--) {
            R = B[t].r + this.gamma * R;
            returns[t] = R;
        }
        for (let t = 0; t < T; t++) {
            const c = this.critic.forward(B[t].s);
            const advantage = returns[t] - c.out[0];             // A = G - V(s)
            this.critic.backward(c.acts, [c.out[0] - returns[t]]); // MSE
            const p = this.actor.forward(B[t].s);
            const probs = NN.softmax(p.out);
            this.actor.backward(p.acts, NN.policyGradLogits(probs, B[t].a, advantage, this.entropyCoef));
        }
        this.critic.step(this.criticLr, 1);
        this.actor.step(this.actorLr, 1);
        this.batch = [];
    };

    A2CAgent.prototype.endEpisode = function (result) { recordEpisode(this, result); };
    A2CAgent.prototype.getActionProbs = function (s) { return NN.softmax(this.actor.predict(s)); };
    A2CAgent.prototype.getValue = function (s) { return this.critic.predict(s)[0]; };

    A2CAgent.prototype.serialize = function () {
        return { algo: 'a2c', actor: this.actor.serialize(), critic: this.critic.serialize(),
                 episodes: this.episodes, landings: this.landings, totalGames: this.totalGames };
    };
    A2CAgent.deserialize = function (d) {
        const a = new A2CAgent();
        a.actor = NN.MLP.deserialize(d.actor);
        a.critic = NN.MLP.deserialize(d.critic);
        a.episodes = d.episodes || 0; a.landings = d.landings || 0; a.totalGames = d.totalGames || 0;
        return a;
    };

    // ========================================================
    // 3. PPO: clipped surrogate objective + GAE
    // ========================================================
    function PPOAgent() {
        this.actor = new NN.MLP([N_STATE].concat(HIDDEN, [N_ACT]), 0.01);
        this.critic = new NN.MLP([N_STATE].concat(HIDDEN, [1]));
        this.gamma = 0.99;
        this.lam = 0.95;
        this.clipEps = 0.2;
        this.lr = 3e-4;
        this.entropyCoef = 0.01;
        this.rolloutLen = 2048;
        this.epochs = 4;
        this.minibatch = 64;
        this.rollout = [];
        Stats(this);
    }

    PPOAgent.prototype.act = function (s) {
        return NN.sample(NN.softmax(this.actor.predict(s)));
    };

    PPOAgent.prototype.observe = function (s, a, r, s2, done) {
        // Remember π_old(a|s) and V(s) at collection time
        const probs = NN.softmax(this.actor.predict(s));
        this.rollout.push({ s, a, r, s2, done, oldP: probs[a], v: this.critic.predict(s)[0] });
        if (this.rollout.length >= this.rolloutLen) this.update();
    };

    PPOAgent.prototype.update = function () {
        const R = this.rollout, T = R.length;
        // Generalised Advantage Estimation, walking backwards
        const adv = new Float64Array(T), ret = new Float64Array(T);
        let gae = 0;
        for (let t = T - 1; t >= 0; t--) {
            const st = R[t];
            let nextV;
            if (st.done) nextV = 0;
            else if (t + 1 < T && R[t + 1].s === st.s2) nextV = R[t + 1].v;
            else nextV = this.critic.predict(st.s2)[0];
            const delta = st.r + this.gamma * nextV - st.v;
            gae = delta + this.gamma * this.lam * (st.done ? 0 : 1) * gae;
            adv[t] = gae;
            ret[t] = gae + st.v;
        }
        let mean = 0, sd = 0;
        for (let t = 0; t < T; t++) mean += adv[t];
        mean /= T;
        for (let t = 0; t < T; t++) sd += (adv[t] - mean) * (adv[t] - mean);
        sd = Math.sqrt(sd / T) + 1e-8;
        for (let t = 0; t < T; t++) adv[t] = (adv[t] - mean) / sd;

        const idx = Array.from({ length: T }, (_, i) => i);
        for (let e = 0; e < this.epochs; e++) {
            for (let i = T - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp; }
            for (let start = 0; start < T; start += this.minibatch) {
                const end = Math.min(T, start + this.minibatch);
                for (let k = start; k < end; k++) {
                    const t = idx[k], st = R[t], A = adv[t];
                    const p = this.actor.forward(st.s);
                    const probs = NN.softmax(p.out);
                    const ratio = probs[st.a] / Math.max(st.oldP, 1e-8);
                    // min(ratio·A, clip(ratio)·A): no policy gradient once the clip binds
                    const clipped = (A > 0 && ratio > 1 + this.clipEps) || (A < 0 && ratio < 1 - this.clipEps);
                    this.actor.backward(p.acts, NN.policyGradLogits(probs, st.a, clipped ? 0 : A * ratio, this.entropyCoef));
                    const c = this.critic.forward(st.s);
                    this.critic.backward(c.acts, [c.out[0] - ret[t]]);
                }
                this.actor.step(this.lr, 0.5);
                this.critic.step(this.lr * 3, 0.5);
            }
        }
        this.rollout = [];
    };

    PPOAgent.prototype.endEpisode = function (result) { recordEpisode(this, result); };
    PPOAgent.prototype.getActionProbs = function (s) { return NN.softmax(this.actor.predict(s)); };
    PPOAgent.prototype.getValue = function (s) { return this.critic.predict(s)[0]; };

    PPOAgent.prototype.serialize = function () {
        return { algo: 'ppo', actor: this.actor.serialize(), critic: this.critic.serialize(),
                 episodes: this.episodes, landings: this.landings, totalGames: this.totalGames };
    };
    PPOAgent.deserialize = function (d) {
        const a = new PPOAgent();
        a.actor = NN.MLP.deserialize(d.actor);
        a.critic = NN.MLP.deserialize(d.critic);
        a.episodes = d.episodes || 0; a.landings = d.landings || 0; a.totalGames = d.totalGames || 0;
        return a;
    };

    const Agents = { dqn: DQNAgent, a2c: A2CAgent, ppo: PPOAgent };
    function create(algo) { return new Agents[algo](); }
    function deserialize(d) { return Agents[d.algo].deserialize(d); }

    return { DQNAgent, A2CAgent, PPOAgent, create, deserialize };
})();

if (typeof module !== 'undefined') module.exports = LanderRL;
