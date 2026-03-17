// ========== LUNAR LANDER RL AGENTS ==========
// MiniNet neural network + DQN, A2C (Advantage Actor-Critic), PPO agents

const LanderRL = (function () {
    'use strict';

    // ---- Utility ----
    function randn() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    // ---- MiniNet: tiny 2-layer neural network ----
    function MiniNet(nIn, nHid, nOut) {
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
        const hidden = new Float64Array(nHid);
        for (let j = 0; j < nHid; j++) {
            let sum = bH[j];
            for (let i = 0; i < nIn; i++) sum += input[i] * wH[i * nHid + j];
            hidden[j] = sum > 0 ? sum : 0; // ReLU
        }
        const out = new Float64Array(nOut);
        for (let k = 0; k < nOut; k++) {
            let sum = bO[k];
            for (let j = 0; j < nHid; j++) sum += hidden[j] * wO[j * nOut + k];
            out[k] = sum;
        }
        return { out, hidden };
    };

    MiniNet.prototype.trainMSE = function (input, target, lr) {
        const { nIn, nHid, nOut, wH, bH, wO, bO } = this;
        const { out, hidden } = this.forward(input);

        const dOut = new Float64Array(nOut);
        for (let k = 0; k < nOut; k++) dOut[k] = out[k] - target[k];

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

        return out;
    };

    // Train value head with MSE on a scalar target
    MiniNet.prototype.trainValue = function (input, targetVal, lr) {
        const target = new Float64Array([targetVal]);
        return this.trainMSE(input, target, lr);
    };

    // Policy gradient with entropy regularization
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

        let entropy = 0;
        for (let k = 0; k < nOut; k++) {
            if (probs[k] > 1e-10) entropy -= probs[k] * Math.log(probs[k]);
        }

        const dOut = new Float64Array(nOut);
        for (let k = 0; k < nOut; k++) {
            const policyGrad = (k === actionIdx ? 1 : 0) - probs[k];
            const logP = probs[k] > 1e-10 ? Math.log(probs[k]) : -20;
            const entropyGrad = -probs[k] * (logP + entropy);
            dOut[k] = -(advantage * policyGrad + (entropyCoef || 0) * entropyGrad);
        }

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

        return probs;
    };

    // PPO clipped objective training
    // oldProbs: Float64Array of action probabilities from the old policy
    MiniNet.prototype.trainPPO = function (input, actionIdx, advantage, oldProbs, lr, clipEps, entropyCoef) {
        const { nIn, nHid, nOut, wH, bH, wO, bO } = this;
        const { out, hidden } = this.forward(input);

        // Softmax -> current probabilities
        const maxV = Math.max(...out);
        const exps = new Float64Array(nOut);
        let sumExp = 0;
        for (let k = 0; k < nOut; k++) {
            exps[k] = Math.exp(out[k] - maxV);
            sumExp += exps[k];
        }
        const probs = new Float64Array(nOut);
        for (let k = 0; k < nOut; k++) probs[k] = exps[k] / sumExp;

        // Importance ratio for the taken action
        const oldP = Math.max(oldProbs[actionIdx], 1e-10);
        const newP = Math.max(probs[actionIdx], 1e-10);
        const ratio = newP / oldP;

        // Clipped surrogate
        const clipped = Math.max(1 - clipEps, Math.min(1 + clipEps, ratio));
        const surr1 = ratio * advantage;
        const surr2 = clipped * advantage;
        // We want to maximize min(surr1, surr2) — take gradient of the binding one
        const useClipped = (surr1 > surr2) ? 1 : 0;
        const effectiveRatio = useClipped ? clipped : ratio;

        // Entropy bonus
        let entropy = 0;
        for (let k = 0; k < nOut; k++) {
            if (probs[k] > 1e-10) entropy -= probs[k] * Math.log(probs[k]);
        }

        // Gradient of clipped PPO objective w.r.t. logits
        // d(ratio * adv)/d(logit_k) = ratio * adv * (delta_ka - pi_k) when not clipped
        // If clipped, gradient is 0 for the ratio part
        const dOut = new Float64Array(nOut);
        for (let k = 0; k < nOut; k++) {
            let policyGrad = 0;
            if (!useClipped) {
                // Gradient flows through the ratio
                policyGrad = advantage * ratio * ((k === actionIdx ? 1 : 0) - probs[k]);
            }
            // Entropy gradient always flows
            const logP = probs[k] > 1e-10 ? Math.log(probs[k]) : -20;
            const entropyGrad = -probs[k] * (logP + entropy);
            // Negate for w -= convention (maximizing)
            dOut[k] = -(policyGrad + (entropyCoef || 0) * entropyGrad);
        }

        // Backprop
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

        return probs;
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

    MiniNet.prototype.copyFrom = function (other) {
        this.wH.set(other.wH);
        this.bH.set(other.bH);
        this.wO.set(other.wO);
        this.bO.set(other.bO);
    };

    // ========================================================
    // 1. DQN AGENT — Double DQN + Replay Buffer
    //    MiniNet(8, 64, 6) = 8×64+64 + 64×6+6 = 966 params
    // ========================================================
    function DQNAgent() {
        this.net = new MiniNet(8, 64, 6);
        this.targetNet = new MiniNet(8, 64, 6);
        this.targetNet.copyFrom(this.net);

        this.replayBuffer = [];
        this.bufferMax = 10000;
        this.batchSize = 32;
        this.gamma = 0.99;
        this.lr = 0.002;
        this.epsilon = 1.0;
        this.epsilonDecay = 0.9997;  // reach ~0.05 in ~10K steps
        this.epsilonMin = 0.05;
        this.episodes = 0;
        this.landings = 0;
        this.totalGames = 0;
        this.stepCount = 0;
        this.targetSyncSteps = 200;
        this.trainEvery = 4;
    }

    DQNAgent.prototype.chooseAction = function (state) {
        if (Math.random() < this.epsilon) {
            return Math.floor(Math.random() * 6);
        }
        const { out } = this.net.forward(state);
        let best = 0;
        for (let i = 1; i < 6; i++) if (out[i] > out[best]) best = i;
        return best;
    };

    DQNAgent.prototype.storeTransition = function (s, a, r, sNext, done) {
        this.replayBuffer.push({ s, a, r, sNext, done });
        if (this.replayBuffer.length > this.bufferMax) {
            this.replayBuffer.shift();
        }
        this.stepCount++;
        this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);

        if (this.stepCount % this.trainEvery === 0) {
            this.train();
        }
        if (this.stepCount % this.targetSyncSteps === 0) {
            this.targetNet.copyFrom(this.net);
        }
    };

    DQNAgent.prototype.onEpisodeEnd = function (result) {
        this.episodes++;
        this.totalGames++;
        if (result === 'landed') this.landings++;
    };

    DQNAgent.prototype.train = function () {
        if (this.replayBuffer.length < this.batchSize) return;

        for (let b = 0; b < this.batchSize; b++) {
            const idx = Math.floor(Math.random() * this.replayBuffer.length);
            const { s, a, r, sNext, done } = this.replayBuffer[idx];

            let maxQ = 0;
            if (!done) {
                // Double DQN
                const { out: qOnline } = this.net.forward(sNext);
                let bestAction = 0;
                for (let i = 1; i < 6; i++) if (qOnline[i] > qOnline[bestAction]) bestAction = i;
                const { out: qTarget } = this.targetNet.forward(sNext);
                maxQ = qTarget[bestAction];
            }
            const targetVal = r + this.gamma * maxQ;

            const { out: qCur } = this.net.forward(s);
            const targetArr = new Float64Array(qCur);
            targetArr[a] = targetVal;

            this.net.trainMSE(s, targetArr, this.lr);
        }
    };

    DQNAgent.prototype.getActionProbs = function (state) {
        const { out } = this.net.forward(state);
        // Convert Q-values to pseudo-probabilities via softmax for visualization
        const maxV = Math.max(...out);
        const exps = new Float64Array(6);
        let sum = 0;
        for (let k = 0; k < 6; k++) {
            exps[k] = Math.exp((out[k] - maxV) * 2); // temperature=0.5 for sharper display
            sum += exps[k];
        }
        const probs = new Float64Array(6);
        for (let k = 0; k < 6; k++) probs[k] = exps[k] / sum;
        return probs;
    };

    DQNAgent.prototype.getValue = function (state) {
        const { out } = this.net.forward(state);
        let maxQ = out[0];
        for (let i = 1; i < 6; i++) if (out[i] > maxQ) maxQ = out[i];
        return maxQ;
    };

    DQNAgent.prototype.serialize = function () {
        return {
            net: this.net.serialize(),
            targetNet: this.targetNet.serialize(),
            epsilon: this.epsilon,
            episodes: this.episodes,
            landings: this.landings,
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
        a.landings = d.landings || 0;
        a.totalGames = d.totalGames || 0;
        a.stepCount = d.stepCount || 0;
        return a;
    };

    // ========================================================
    // 2. A2C AGENT — Advantage Actor-Critic
    //    Actor: MiniNet(8, 48, 6) = 8×48+48 + 48×6+6 = 726 params
    //    Critic: MiniNet(8, 48, 1) = 8×48+48 + 48×1+1 = 481 params
    //    Total: 1,207 params
    // ========================================================
    function A2CAgent() {
        this.actor = new MiniNet(8, 48, 6);
        this.critic = new MiniNet(8, 48, 1);

        this.gamma = 0.99;
        this.actorLr = 0.003;
        this.criticLr = 0.008;
        this.entropyCoef = 0.04;
        this.epsilon = 0.15;
        this.epsilonDecay = 0.997;
        this.epsilonMin = 0.02;
        this.episodes = 0;
        this.landings = 0;
        this.totalGames = 0;

        this.prevState = null;
        this.prevAction = null;

        // N-step buffer for lower variance updates
        this.nStepBuffer = [];
        this.nSteps = 16;
    }

    A2CAgent.prototype.chooseAction = function (state) {
        if (Math.random() < this.epsilon) {
            return Math.floor(Math.random() * 6);
        }
        const probs = this.actor.softmax(state);
        const r = Math.random();
        let cumulative = 0;
        for (let i = 0; i < probs.length; i++) {
            cumulative += probs[i];
            if (r <= cumulative) return i;
        }
        return probs.length - 1;
    };

    A2CAgent.prototype.update = function (state, action, reward, nextState, done) {
        // Accumulate steps
        this.nStepBuffer.push({ state: state, action: action, reward: reward, nextState: nextState, done: done });

        // Train when buffer is full or episode ends
        if (this.nStepBuffer.length >= this.nSteps || done) {
            this._trainBatch();
        }
    };

    A2CAgent.prototype._trainBatch = function () {
        const buf = this.nStepBuffer;
        if (buf.length === 0) return;

        // Compute N-step returns and advantages
        const T = buf.length;
        const lastStep = buf[T - 1];
        let bootstrapV = 0;
        if (!lastStep.done) {
            const { out: vN } = this.critic.forward(lastStep.nextState);
            bootstrapV = vN[0];
        }

        // Backward pass to compute returns
        const returns = new Float64Array(T);
        returns[T - 1] = buf[T - 1].reward + this.gamma * bootstrapV;
        for (let t = T - 2; t >= 0; t--) {
            if (buf[t].done) {
                returns[t] = buf[t].reward;
            } else {
                returns[t] = buf[t].reward + this.gamma * returns[t + 1];
            }
        }

        // Update actor and critic for each step
        for (let t = 0; t < T; t++) {
            const { out: vCur } = this.critic.forward(buf[t].state);
            const advantage = Math.max(-5, Math.min(5, returns[t] - vCur[0]));

            this.critic.trainValue(buf[t].state, returns[t], this.criticLr);
            this.actor.trainPG(buf[t].state, buf[t].action, advantage, this.actorLr, this.entropyCoef);
        }

        this.nStepBuffer = [];
    };

    A2CAgent.prototype.onEpisodeEnd = function (result) {
        // Flush any remaining steps in the buffer
        if (this.nStepBuffer.length > 0) {
            this._trainBatch();
        }
        this.episodes++;
        this.totalGames++;
        if (result === 'landed') this.landings++;
        this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
        this.prevState = null;
        this.prevAction = null;
    };

    A2CAgent.prototype.getActionProbs = function (state) {
        return this.actor.softmax(state);
    };

    A2CAgent.prototype.getValue = function (state) {
        const { out } = this.critic.forward(state);
        return out[0];
    };

    A2CAgent.prototype.serialize = function () {
        return {
            actor: this.actor.serialize(),
            critic: this.critic.serialize(),
            epsilon: this.epsilon,
            episodes: this.episodes,
            landings: this.landings,
            totalGames: this.totalGames
        };
    };

    A2CAgent.deserialize = function (d) {
        const a = new A2CAgent();
        if (d.actor) a.actor = MiniNet.deserialize(d.actor);
        if (d.critic) a.critic = MiniNet.deserialize(d.critic);
        a.epsilon = d.epsilon !== undefined ? d.epsilon : 0.2;
        a.episodes = d.episodes || 0;
        a.landings = d.landings || 0;
        a.totalGames = d.totalGames || 0;
        return a;
    };

    // ========================================================
    // 3. PPO AGENT — Proximal Policy Optimization
    //    Same architecture as A2C: 1,207 params
    //    Collects trajectories, then runs mini-batch updates
    // ========================================================
    function PPOAgent() {
        this.actor = new MiniNet(8, 48, 6);
        this.critic = new MiniNet(8, 48, 1);

        this.gamma = 0.99;
        this.lam = 0.95;         // GAE lambda
        this.clipEps = 0.2;
        this.actorLr = 0.005;
        this.criticLr = 0.01;
        this.entropyCoef = 0.04;
        this.epochs = 3;
        this.trajectoryLen = 64;
        this.epsilon = 0.15;
        this.epsilonDecay = 0.999;
        this.epsilonMin = 0.01;
        this.episodes = 0;
        this.landings = 0;
        this.totalGames = 0;

        // Trajectory buffer
        this.trajectory = [];
    }

    PPOAgent.prototype.chooseAction = function (state) {
        if (Math.random() < this.epsilon) {
            return Math.floor(Math.random() * 6);
        }
        const probs = this.actor.softmax(state);
        const r = Math.random();
        let cumulative = 0;
        for (let i = 0; i < probs.length; i++) {
            cumulative += probs[i];
            if (r <= cumulative) return i;
        }
        return probs.length - 1;
    };

    PPOAgent.prototype.storeStep = function (state, action, reward, done) {
        const probs = this.actor.softmax(state);
        const { out: vOut } = this.critic.forward(state);
        this.trajectory.push({
            state: state.slice ? state.slice() : Array.from(state),
            action: action,
            reward: reward,
            done: done,
            oldProbs: new Float64Array(probs),
            value: vOut[0]
        });

        // Train when trajectory is full
        if (this.trajectory.length >= this.trajectoryLen) {
            this.trainOnTrajectory();
        }
    };

    PPOAgent.prototype.trainOnTrajectory = function () {
        const T = this.trajectory.length;
        if (T === 0) return;

        // Compute GAE advantages
        const advantages = new Float64Array(T);
        const returns = new Float64Array(T);

        // Bootstrap value for last state
        const lastStep = this.trajectory[T - 1];
        let nextValue = lastStep.done ? 0 : lastStep.value;

        let gae = 0;
        for (let t = T - 1; t >= 0; t--) {
            const step = this.trajectory[t];
            const nextV = (t === T - 1) ? nextValue :
                          this.trajectory[t + 1].done ? 0 : this.trajectory[t + 1].value;
            const delta = step.reward + this.gamma * nextV - step.value;
            gae = delta + this.gamma * this.lam * (step.done ? 0 : 1) * gae;
            advantages[t] = gae;
            returns[t] = gae + step.value;
        }

        // Normalize advantages
        let mean = 0, std = 0;
        for (let t = 0; t < T; t++) mean += advantages[t];
        mean /= T;
        for (let t = 0; t < T; t++) std += (advantages[t] - mean) ** 2;
        std = Math.sqrt(std / T + 1e-8);
        for (let t = 0; t < T; t++) advantages[t] = (advantages[t] - mean) / std;

        // Multiple epochs of mini-batch updates
        for (let epoch = 0; epoch < this.epochs; epoch++) {
            // Shuffle indices
            const indices = [];
            for (let i = 0; i < T; i++) indices.push(i);
            for (let i = T - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = indices[i]; indices[i] = indices[j]; indices[j] = tmp;
            }

            for (let i = 0; i < T; i++) {
                const t = indices[i];
                const step = this.trajectory[t];

                // Actor: PPO clipped update
                this.actor.trainPPO(
                    step.state, step.action, advantages[t],
                    step.oldProbs, this.actorLr, this.clipEps, this.entropyCoef
                );

                // Critic: MSE on returns
                this.critic.trainValue(step.state, returns[t], this.criticLr);
            }
        }

        this.trajectory = [];
    };

    PPOAgent.prototype.onEpisodeEnd = function (result) {
        this.episodes++;
        this.totalGames++;
        if (result === 'landed') this.landings++;
        this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
    };

    PPOAgent.prototype.getActionProbs = function (state) {
        return this.actor.softmax(state);
    };

    PPOAgent.prototype.getValue = function (state) {
        const { out } = this.critic.forward(state);
        return out[0];
    };

    PPOAgent.prototype.serialize = function () {
        return {
            actor: this.actor.serialize(),
            critic: this.critic.serialize(),
            epsilon: this.epsilon,
            episodes: this.episodes,
            landings: this.landings,
            totalGames: this.totalGames
        };
    };

    PPOAgent.deserialize = function (d) {
        const a = new PPOAgent();
        if (d.actor) a.actor = MiniNet.deserialize(d.actor);
        if (d.critic) a.critic = MiniNet.deserialize(d.critic);
        a.epsilon = d.epsilon !== undefined ? d.epsilon : 0.15;
        a.episodes = d.episodes || 0;
        a.landings = d.landings || 0;
        a.totalGames = d.totalGames || 0;
        return a;
    };

    // ========================================================
    // Public API
    // ========================================================
    return {
        DQNAgent,
        A2CAgent,
        PPOAgent,
        MiniNet
    };
})();
