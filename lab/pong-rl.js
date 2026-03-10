// ========== PONG RL AGENTS ==========
// MiniNet neural network + Q-Learning, DQN, and REINFORCE agents

const PongRL = (function () {
    'use strict';

    // ---- Utility ----
    function randn() {
        // Box-Muller transform
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    // ---- MiniNet: tiny 2-layer neural network ----
    // Architecture: inputs -> hidden (ReLU) -> outputs
    // Uses Float64Array for precision

    function MiniNet(nIn, nHid, nOut) {
        // Xavier init
        const scaleH = Math.sqrt(2.0 / nIn);
        const scaleO = Math.sqrt(2.0 / nHid);

        this.nIn = nIn;
        this.nHid = nHid;
        this.nOut = nOut;

        this.wH = new Float64Array(nIn * nHid);
        this.bH = new Float64Array(nHid);
        this.wO = new Float64Array(nHid * nOut);
        this.bO = new Float64Array(nOut);

        for (let i = 0; i < this.wH.length; i++) this.wH[i] = randn() * scaleH;
        for (let i = 0; i < this.wO.length; i++) this.wO[i] = randn() * scaleO;
    }

    MiniNet.prototype.forward = function (input) {
        const { nIn, nHid, nOut, wH, bH, wO, bO } = this;
        // Hidden layer
        const hidden = new Float64Array(nHid);
        for (let j = 0; j < nHid; j++) {
            let sum = bH[j];
            for (let i = 0; i < nIn; i++) sum += input[i] * wH[i * nHid + j];
            hidden[j] = sum > 0 ? sum : 0; // ReLU
        }
        // Output layer
        const out = new Float64Array(nOut);
        for (let k = 0; k < nOut; k++) {
            let sum = bO[k];
            for (let j = 0; j < nHid; j++) sum += hidden[j] * wO[j * nOut + k];
            out[k] = sum;
        }
        return { out, hidden };
    };

    // Backprop for MSE loss (DQN): computes gradients and applies them
    MiniNet.prototype.trainMSE = function (input, target, lr) {
        const { nIn, nHid, nOut, wH, bH, wO, bO } = this;
        const { out, hidden } = this.forward(input);

        // Output error
        const dOut = new Float64Array(nOut);
        for (let k = 0; k < nOut; k++) dOut[k] = out[k] - target[k];

        // Gradients for output layer
        const dHidden = new Float64Array(nHid);
        for (let j = 0; j < nHid; j++) {
            let grad = 0;
            for (let k = 0; k < nOut; k++) {
                grad += dOut[k] * wO[j * nOut + k];
                wO[j * nOut + k] -= lr * dOut[k] * hidden[j];
            }
            // ReLU derivative
            dHidden[j] = hidden[j] > 0 ? grad : 0;
        }

        // Gradients for hidden layer
        for (let i = 0; i < nIn; i++) {
            for (let j = 0; j < nHid; j++) {
                wH[i * nHid + j] -= lr * dHidden[j] * input[i];
            }
        }

        // Bias gradients
        for (let k = 0; k < nOut; k++) bO[k] -= lr * dOut[k];
        for (let j = 0; j < nHid; j++) bH[j] -= lr * dHidden[j];

        return out;
    };

    // Backprop for policy gradient with entropy regularization
    // Objective: maximize advantage * log π(a|s) + β * H(π)
    // where H(π) = -Σ π_k log π_k is the entropy bonus
    MiniNet.prototype.trainPG = function (input, actionIdx, advantage, lr, entropyCoef) {
        const { nIn, nHid, nOut, wH, bH, wO, bO } = this;
        const { out, hidden } = this.forward(input);

        // Softmax
        const maxV = Math.max(...out);
        const exps = new Float64Array(nOut);
        let sumExp = 0;
        for (let k = 0; k < nOut; k++) {
            exps[k] = Math.exp(out[k] - maxV);
            sumExp += exps[k];
        }
        const probs = new Float64Array(nOut);
        for (let k = 0; k < nOut; k++) probs[k] = exps[k] / sumExp;

        // Policy gradient: dJ/dz_k = advantage * (one_hot_k - probs_k)
        // Entropy gradient: dH/dz_k = -probs_k * (log probs_k + H)
        //   where H = -Σ probs_j * log probs_j
        // Combined for gradient ASCENT, negated for w -= convention:
        let entropy = 0;
        for (let k = 0; k < nOut; k++) {
            if (probs[k] > 1e-10) entropy -= probs[k] * Math.log(probs[k]);
        }

        const dOut = new Float64Array(nOut);
        for (let k = 0; k < nOut; k++) {
            const policyGrad = (k === actionIdx ? 1 : 0) - probs[k];
            const logP = probs[k] > 1e-10 ? Math.log(probs[k]) : -20;
            const entropyGrad = -probs[k] * (logP + entropy);
            // Negate for w -= lr * dOut convention (ascent)
            dOut[k] = -(advantage * policyGrad + (entropyCoef || 0) * entropyGrad);
        }

        // Backprop through output layer
        const dHidden = new Float64Array(nHid);
        for (let j = 0; j < nHid; j++) {
            let grad = 0;
            for (let k = 0; k < nOut; k++) {
                grad += dOut[k] * wO[j * nOut + k];
                wO[j * nOut + k] -= lr * dOut[k] * hidden[j];
            }
            dHidden[j] = hidden[j] > 0 ? grad : 0;
        }

        for (let i = 0; i < nIn; i++) {
            for (let j = 0; j < nHid; j++) {
                wH[i * nHid + j] -= lr * dHidden[j] * input[i];
            }
        }
        for (let k = 0; k < nOut; k++) bO[k] -= lr * dOut[k];
        for (let j = 0; j < nHid; j++) bH[j] -= lr * dHidden[j];
    };

    MiniNet.prototype.softmax = function (input) {
        const { out } = this.forward(input);
        const maxV = Math.max(...out);
        const exps = new Float64Array(out.length);
        let sum = 0;
        for (let k = 0; k < out.length; k++) {
            exps[k] = Math.exp(out[k] - maxV);
            sum += exps[k];
        }
        const probs = new Float64Array(out.length);
        for (let k = 0; k < out.length; k++) probs[k] = exps[k] / sum;
        return probs;
    };

    MiniNet.prototype.serialize = function () {
        return {
            nIn: this.nIn, nHid: this.nHid, nOut: this.nOut,
            wH: Array.from(this.wH), bH: Array.from(this.bH),
            wO: Array.from(this.wO), bO: Array.from(this.bO)
        };
    };

    MiniNet.deserialize = function (d) {
        const net = new MiniNet(d.nIn, d.nHid, d.nOut);
        net.wH = new Float64Array(d.wH);
        net.bH = new Float64Array(d.bH);
        net.wO = new Float64Array(d.wO);
        net.bO = new Float64Array(d.bO);
        return net;
    };

    // Copy weights from another net
    MiniNet.prototype.copyFrom = function (other) {
        this.wH.set(other.wH);
        this.bH.set(other.bH);
        this.wO.set(other.wO);
        this.bO.set(other.bO);
    };

    // ========================================================
    // 1. Q-LEARNING AGENT
    // ========================================================
    function QLearningAgent() {
        this.Q = {};         // state -> [q0, q1, q2]
        this.lr = 0.1;
        this.gamma = 0.99;
        this.epsilon = 1.0;
        this.epsilonDecay = 0.9995;
        this.epsilonMin = 0.05;
        this.episodes = 0;
        this.wins = 0;
        this.totalGames = 0;
    }

    QLearningAgent.prototype.getQ = function (s) {
        if (!this.Q[s]) this.Q[s] = [0, 0, 0];
        return this.Q[s];
    };

    QLearningAgent.prototype.chooseAction = function (discreteState) {
        if (Math.random() < this.epsilon) {
            return Math.floor(Math.random() * 3);
        }
        const q = this.getQ(discreteState);
        let best = 0;
        for (let i = 1; i < 3; i++) if (q[i] > q[best]) best = i;
        return best;
    };

    QLearningAgent.prototype.update = function (s, a, r, sNext, done) {
        const q = this.getQ(s);
        const qNext = this.getQ(sNext);
        const maxNext = done ? 0 : Math.max(...qNext);
        q[a] += this.lr * (r + this.gamma * maxNext - q[a]);
    };

    QLearningAgent.prototype.onEpisodeEnd = function (winner) {
        this.episodes++;
        this.totalGames++;
        if (winner === 'ai') this.wins++;
        this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
    };

    QLearningAgent.prototype.serialize = function () {
        return {
            Q: this.Q,
            epsilon: this.epsilon,
            episodes: this.episodes,
            wins: this.wins,
            totalGames: this.totalGames
        };
    };

    QLearningAgent.deserialize = function (d) {
        const a = new QLearningAgent();
        a.Q = d.Q || {};
        a.epsilon = d.epsilon || 1.0;
        a.episodes = d.episodes || 0;
        a.wins = d.wins || 0;
        a.totalGames = d.totalGames || 0;
        return a;
    };

    // ========================================================
    // 2. DQN AGENT
    // ========================================================
    function DQNAgent() {
        this.net = new MiniNet(6, 32, 3);
        this.targetNet = new MiniNet(6, 32, 3);
        this.targetNet.copyFrom(this.net);

        this.replayBuffer = [];
        this.bufferMax = 10000;
        this.batchSize = 32;
        this.gamma = 0.99;
        this.lr = 0.001;
        this.epsilon = 1.0;
        this.epsilonDecay = 0.998;
        this.epsilonMin = 0.05;
        this.episodes = 0;
        this.wins = 0;
        this.totalGames = 0;
        this.stepCount = 0;
        this.targetSyncSteps = 200; // sync target net every N steps
        this.trainEvery = 4;        // train every N steps
    }

    DQNAgent.prototype.chooseAction = function (state) {
        if (Math.random() < this.epsilon) {
            return Math.floor(Math.random() * 3);
        }
        const { out } = this.net.forward(state);
        let best = 0;
        for (let i = 1; i < 3; i++) if (out[i] > out[best]) best = i;
        return best;
    };

    DQNAgent.prototype.storeTransition = function (s, a, r, sNext, done) {
        this.replayBuffer.push({ s, a, r, sNext, done });
        if (this.replayBuffer.length > this.bufferMax) {
            this.replayBuffer.shift();
        }
        this.stepCount++;

        // Train every N steps (not just at episode end)
        if (this.stepCount % this.trainEvery === 0) {
            this.train();
        }

        // Sync target network every N steps
        if (this.stepCount % this.targetSyncSteps === 0) {
            this.targetNet.copyFrom(this.net);
        }
    };

    DQNAgent.prototype.onEpisodeEnd = function (winner) {
        this.episodes++;
        this.totalGames++;
        if (winner === 'ai') this.wins++;
        this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
    };

    DQNAgent.prototype.train = function () {
        if (this.replayBuffer.length < this.batchSize) return;

        for (let b = 0; b < this.batchSize; b++) {
            const idx = Math.floor(Math.random() * this.replayBuffer.length);
            const { s, a, r, sNext, done } = this.replayBuffer[idx];

            // Compute target
            const { out: qNext } = this.targetNet.forward(sNext);
            const maxQ = done ? 0 : Math.max(...qNext);
            const target_val = r + this.gamma * maxQ;

            // Current Q-values — build target array
            const { out: qCur } = this.net.forward(s);
            const targetArr = new Float64Array(qCur);
            targetArr[a] = target_val;

            this.net.trainMSE(s, targetArr, this.lr);
        }
    };

    DQNAgent.prototype.serialize = function () {
        return {
            net: this.net.serialize(),
            targetNet: this.targetNet.serialize(),
            epsilon: this.epsilon,
            episodes: this.episodes,
            wins: this.wins,
            totalGames: this.totalGames,
            stepCount: this.stepCount
        };
    };

    DQNAgent.deserialize = function (d) {
        const a = new DQNAgent();
        if (d.net) a.net = MiniNet.deserialize(d.net);
        if (d.targetNet) a.targetNet = MiniNet.deserialize(d.targetNet);
        a.epsilon = d.epsilon || 1.0;
        a.episodes = d.episodes || 0;
        a.wins = d.wins || 0;
        a.totalGames = d.totalGames || 0;
        a.stepCount = d.stepCount || 0;
        return a;
    };

    // ========================================================
    // 3. REINFORCE (Policy Gradient) AGENT
    // ========================================================
    function ReinforceAgent() {
        this.net = new MiniNet(6, 32, 3);
        this.lr = 0.005;
        this.gamma = 0.99;
        this.entropyCoef = 0.02;     // entropy bonus to prevent policy collapse
        this.epsilon = 0.3;          // exploration rate
        this.epsilonDecay = 0.997;
        this.epsilonMin = 0.05;
        this.episodes = 0;
        this.wins = 0;
        this.totalGames = 0;

        // Trajectory for current episode
        this.trajectory = [];
    }

    ReinforceAgent.prototype.chooseAction = function (state) {
        // ε-greedy: random action with probability ε
        if (Math.random() < this.epsilon) {
            return Math.floor(Math.random() * 3);
        }
        const probs = this.net.softmax(state);
        // Sample from policy distribution
        const r = Math.random();
        let cumulative = 0;
        for (let i = 0; i < probs.length; i++) {
            cumulative += probs[i];
            if (r <= cumulative) return i;
        }
        return probs.length - 1;
    };

    ReinforceAgent.prototype.storeStep = function (state, action, reward) {
        this.trajectory.push({ state, action, reward });
    };

    ReinforceAgent.prototype.onEpisodeEnd = function (winner) {
        this.episodes++;
        this.totalGames++;
        if (winner === 'ai') this.wins++;
        this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);

        // Compute discounted returns
        const T = this.trajectory.length;
        if (T === 0) { this.trajectory = []; return; }

        const returns = new Float64Array(T);
        returns[T - 1] = this.trajectory[T - 1].reward;
        for (let t = T - 2; t >= 0; t--) {
            returns[t] = this.trajectory[t].reward + this.gamma * returns[t + 1];
        }

        // Baseline normalization
        let mean = 0, std = 0;
        for (let t = 0; t < T; t++) mean += returns[t];
        mean /= T;
        for (let t = 0; t < T; t++) std += (returns[t] - mean) ** 2;
        std = Math.sqrt(std / T + 1e-8);

        // Train — gradient ascent on log-likelihood weighted by advantage + entropy
        const maxSteps = Math.min(T, 300);
        const stride = Math.max(1, Math.floor(T / maxSteps));
        for (let t = 0; t < T; t += stride) {
            const advantage = (returns[t] - mean) / std;
            this.net.trainPG(this.trajectory[t].state, this.trajectory[t].action, advantage, this.lr, this.entropyCoef);
        }

        this.trajectory = [];
    };

    ReinforceAgent.prototype.serialize = function () {
        return {
            net: this.net.serialize(),
            episodes: this.episodes,
            wins: this.wins,
            totalGames: this.totalGames,
            epsilon: this.epsilon
        };
    };

    ReinforceAgent.deserialize = function (d) {
        const a = new ReinforceAgent();
        if (d.net) a.net = MiniNet.deserialize(d.net);
        a.episodes = d.episodes || 0;
        a.wins = d.wins || 0;
        a.totalGames = d.totalGames || 0;
        a.epsilon = d.epsilon !== undefined ? d.epsilon : 0.3;
        return a;
    };

    // ========================================================
    // Public API
    // ========================================================
    return {
        QLearningAgent,
        DQNAgent,
        ReinforceAgent,
        MiniNet
    };
})();
