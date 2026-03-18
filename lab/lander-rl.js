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
        const oldP = Math.max(oldProbs[actionIdx], 1e-8);
        const newP = Math.max(probs[actionIdx], 1e-8);
        const ratio = Math.min(10, newP / oldP); // cap to prevent Inf

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

    // Biased random action — THRUST_MAIN gets 40%, others 12% each
    // Without this, random exploration only fires thrust 17% of the time,
    // but hovering requires 27%. The agent wastes hundreds of episodes
    // before accidentally discovering that thrust is essential.
    function biasedRandomAction() {
        var r = Math.random();
        if (r < 0.40) return 1; // THRUST_MAIN
        var idx = Math.floor((r - 0.40) / 0.12);
        var others = [0, 2, 3, 4, 5];
        return others[Math.min(idx, 4)];
    }
    // Architecture: inputs -> hidden1 (ReLU) -> hidden2 (ReLU) -> outputs
    // Uses Adam optimizer for stable RL training
    function MiniNet2(nIn, nH1, nH2, nOut) {
        this.nIn = nIn; this.nH1 = nH1; this.nH2 = nH2; this.nOut = nOut;
        const s1 = Math.sqrt(2.0 / nIn), s2 = Math.sqrt(2.0 / nH1), sO = Math.sqrt(2.0 / nH2);
        this.w1 = new Float64Array(nIn * nH1);
        this.b1 = new Float64Array(nH1);
        this.w2 = new Float64Array(nH1 * nH2);
        this.b2 = new Float64Array(nH2);
        this.wO = new Float64Array(nH2 * nOut);
        this.bO = new Float64Array(nOut);
        for (let i = 0; i < this.w1.length; i++) this.w1[i] = randn() * s1;
        for (let i = 0; i < this.w2.length; i++) this.w2[i] = randn() * s2;
        for (let i = 0; i < this.wO.length; i++) this.wO[i] = randn() * sO;

        // Adam optimizer state
        this._adamT = 0;
        this._m = {}; this._v = {};
        var names = ['w1','b1','w2','b2','wO','bO'];
        for (var i = 0; i < names.length; i++) {
            this._m[names[i]] = new Float64Array(this[names[i]].length);
            this._v[names[i]] = new Float64Array(this[names[i]].length);
        }
    }

    // Adam update: applies gradients with adaptive learning rates
    MiniNet2.prototype._adam = function (paramName, grads, lr) {
        var params = this[paramName];
        var m = this._m[paramName];
        var v = this._v[paramName];
        var beta1 = 0.9, beta2 = 0.999, eps = 1e-8;
        // Bias correction
        var bc1 = 1 - Math.pow(beta1, this._adamT);
        var bc2 = 1 - Math.pow(beta2, this._adamT);
        for (var i = 0; i < params.length; i++) {
            m[i] = beta1 * m[i] + (1 - beta1) * grads[i];
            v[i] = beta2 * v[i] + (1 - beta2) * grads[i] * grads[i];
            params[i] -= lr * (m[i] / bc1) / (Math.sqrt(v[i] / bc2) + eps);
        }
    };

    // Increment Adam step counter (call once per training step)
    MiniNet2.prototype._adamStep = function () { this._adamT++; };

    MiniNet2.prototype.forward = function (input) {
        const { nIn, nH1, nH2, nOut, w1, b1, w2, b2, wO, bO } = this;
        const h1 = new Float64Array(nH1);
        for (let j = 0; j < nH1; j++) {
            let s = b1[j]; for (let i = 0; i < nIn; i++) s += input[i] * w1[i * nH1 + j]; h1[j] = s > 0 ? s : 0;
        }
        const h2 = new Float64Array(nH2);
        for (let j = 0; j < nH2; j++) {
            let s = b2[j]; for (let i = 0; i < nH1; i++) s += h1[i] * w2[i * nH2 + j]; h2[j] = s > 0 ? s : 0;
        }
        const out = new Float64Array(nOut);
        for (let k = 0; k < nOut; k++) {
            let s = bO[k]; for (let j = 0; j < nH2; j++) s += h2[j] * wO[j * nOut + k]; out[k] = s;
        }
        return { out, hidden: h1, hidden2: h2 };
    };

    // Common backprop helper: given output-layer gradients dOut, backprop through both
    // hidden layers and apply updates via Adam (or SGD if this.useAdam === false)
    MiniNet2.prototype._backpropAdam = function (input, h1, h2, dOut, lr) {
        const { nIn, nH1, nH2, nOut, w1, b1, w2, b2, wO, bO } = this;
        // Output -> H2
        const gWO = new Float64Array(nH2 * nOut);
        const gBO = new Float64Array(nOut);
        const dH2 = new Float64Array(nH2);
        for (let j = 0; j < nH2; j++) {
            let g = 0;
            for (let k = 0; k < nOut; k++) { g += dOut[k] * wO[j * nOut + k]; gWO[j * nOut + k] = dOut[k] * h2[j]; }
            dH2[j] = h2[j] > 0 ? g : 0;
        }
        for (let k = 0; k < nOut; k++) gBO[k] = dOut[k];
        // H2 -> H1
        const gW2 = new Float64Array(nH1 * nH2);
        const gB2 = new Float64Array(nH2);
        const dH1 = new Float64Array(nH1);
        for (let j = 0; j < nH1; j++) {
            let g = 0;
            for (let i = 0; i < nH2; i++) { g += dH2[i] * w2[j * nH2 + i]; gW2[j * nH2 + i] = dH2[i] * h1[j]; }
            dH1[j] = h1[j] > 0 ? g : 0;
        }
        for (let j = 0; j < nH2; j++) gB2[j] = dH2[j];
        // H1 -> Input
        const gW1 = new Float64Array(nIn * nH1);
        const gB1 = new Float64Array(nH1);
        for (let i = 0; i < nIn; i++) for (let j = 0; j < nH1; j++) gW1[i * nH1 + j] = dH1[j] * input[i];
        for (let j = 0; j < nH1; j++) gB1[j] = dH1[j];
        // Apply updates
        if (this.useAdam !== false) {
            this._adamStep();
            this._adam('wO', gWO, lr); this._adam('bO', gBO, lr);
            this._adam('w2', gW2, lr); this._adam('b2', gB2, lr);
            this._adam('w1', gW1, lr); this._adam('b1', gB1, lr);
        } else {
            // Vanilla SGD — better for DQN with non-stationary targets
            for (let i = 0; i < gWO.length; i++) wO[i] -= lr * gWO[i];
            for (let i = 0; i < gBO.length; i++) bO[i] -= lr * gBO[i];
            for (let i = 0; i < gW2.length; i++) w2[i] -= lr * gW2[i];
            for (let i = 0; i < gB2.length; i++) b2[i] -= lr * gB2[i];
            for (let i = 0; i < gW1.length; i++) w1[i] -= lr * gW1[i];
            for (let i = 0; i < gB1.length; i++) b1[i] -= lr * gB1[i];
        }
    };

    MiniNet2.prototype.trainMSE = function (input, target, lr) {
        const { nOut } = this;
        const { out, hidden: h1, hidden2: h2 } = this.forward(input);
        const dOut = new Float64Array(nOut);
        for (let k = 0; k < nOut; k++) dOut[k] = out[k] - target[k];
        this._backpropAdam(input, h1, h2, dOut, lr);
        return out;
    };

    MiniNet2.prototype.trainValue = function (input, val, lr) { return this.trainMSE(input, new Float64Array([val]), lr); };

    MiniNet2.prototype.trainPG = function (input, actionIdx, advantage, lr, ec) {
        const { nOut } = this;
        const { out, hidden: h1, hidden2: h2 } = this.forward(input);
        const maxV = Math.max(...out); const exps = new Float64Array(nOut); let sumExp = 0;
        for (let k = 0; k < nOut; k++) { exps[k] = Math.exp(out[k] - maxV); sumExp += exps[k]; }
        const probs = new Float64Array(nOut);
        for (let k = 0; k < nOut; k++) probs[k] = exps[k] / sumExp;
        let ent = 0; for (let k = 0; k < nOut; k++) if (probs[k] > 1e-10) ent -= probs[k] * Math.log(probs[k]);
        const dOut = new Float64Array(nOut);
        for (let k = 0; k < nOut; k++) {
            const pg = (k === actionIdx ? 1 : 0) - probs[k];
            const lp = probs[k] > 1e-10 ? Math.log(probs[k]) : -20;
            dOut[k] = -(advantage * pg + (ec || 0) * (-probs[k] * (lp + ent)));
        }
        this._backpropAdam(input, h1, h2, dOut, lr);
        return probs;
    };

    MiniNet2.prototype.trainPPO = function (input, actionIdx, advantage, oldProbs, lr, clipEps, ec) {
        const { nOut } = this;
        const { out, hidden: h1, hidden2: h2 } = this.forward(input);
        const maxV = Math.max(...out); const exps = new Float64Array(nOut); let sumExp = 0;
        for (let k = 0; k < nOut; k++) { exps[k] = Math.exp(out[k] - maxV); sumExp += exps[k]; }
        const probs = new Float64Array(nOut);
        for (let k = 0; k < nOut; k++) probs[k] = exps[k] / sumExp;
        const oldP = Math.max(oldProbs[actionIdx], 1e-8), newP = Math.max(probs[actionIdx], 1e-8);
        const ratio = Math.min(10, newP / oldP);
        const clipped = Math.max(1 - clipEps, Math.min(1 + clipEps, ratio));
        const s1 = ratio * advantage, s2 = clipped * advantage;
        const useClip = (s1 > s2) ? 1 : 0;
        let ent = 0; for (let k = 0; k < nOut; k++) if (probs[k] > 1e-10) ent -= probs[k] * Math.log(probs[k]);
        const dOut = new Float64Array(nOut);
        for (let k = 0; k < nOut; k++) {
            let pg = 0;
            if (!useClip) pg = advantage * ratio * ((k === actionIdx ? 1 : 0) - probs[k]);
            const lp = probs[k] > 1e-10 ? Math.log(probs[k]) : -20;
            dOut[k] = -(pg + (ec || 0) * (-probs[k] * (lp + ent)));
        }
        this._backpropAdam(input, h1, h2, dOut, lr);
        return probs;
    };

    MiniNet2.prototype.softmax = function (input) {
        const { out } = this.forward(input); const maxV = Math.max(...out);
        const exps = new Float64Array(out.length); let sum = 0;
        for (let k = 0; k < out.length; k++) { exps[k] = Math.exp(out[k] - maxV); sum += exps[k]; }
        const probs = new Float64Array(out.length);
        for (let k = 0; k < out.length; k++) probs[k] = exps[k] / sum;
        return probs;
    };

    MiniNet2.prototype.serialize = function () {
        return { type: 'MiniNet2', nIn: this.nIn, nH1: this.nH1, nH2: this.nH2, nOut: this.nOut,
            w1: Array.from(this.w1), b1: Array.from(this.b1), w2: Array.from(this.w2), b2: Array.from(this.b2),
            wO: Array.from(this.wO), bO: Array.from(this.bO), adamT: this._adamT };
    };

    MiniNet2.deserialize = function (d) {
        const n = new MiniNet2(d.nIn, d.nH1, d.nH2, d.nOut);
        n.w1 = new Float64Array(d.w1); n.b1 = new Float64Array(d.b1);
        n.w2 = new Float64Array(d.w2); n.b2 = new Float64Array(d.b2);
        n.wO = new Float64Array(d.wO); n.bO = new Float64Array(d.bO);
        if (d.adamT) n._adamT = d.adamT;
        return n;
    };

    MiniNet2.prototype.copyFrom = function (o) {
        this.w1.set(o.w1); this.b1.set(o.b1); this.w2.set(o.w2); this.b2.set(o.b2);
        this.wO.set(o.wO); this.bO.set(o.bO);
    };

    // Helper to deserialize either MiniNet or MiniNet2
    function deserializeNet(d) {
        if (d.type === 'MiniNet2' || d.nH1 !== undefined) return MiniNet2.deserialize(d);
        return MiniNet.deserialize(d);
    }

    // ========================================================
    // 1. DQN AGENT — Double DQN + Replay Buffer
    //    MiniNet2(8, 48, 32, 6) = ~2K params
    // ========================================================
    function DQNAgent() {
        this.net = new MiniNet2(8, 64, 48, 6);
        this.targetNet = new MiniNet2(8, 64, 48, 6);
        // DQN uses SGD — Adam's momentum causes instability with non-stationary Q-targets
        this.net.useAdam = false;
        this.targetNet.useAdam = false;
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
            return biasedRandomAction();
        }
        const { out } = this.net.forward(state);
        let best = 0;
        for (let i = 1; i < 6; i++) if (out[i] > out[best]) best = i;
        return best;
    };

    DQNAgent.prototype.storeTransition = function (s, a, r, sNext, done) {
        const idx = this.replayBuffer.length;
        this.replayBuffer.push({ s, a, r, sNext, done });
        if (this.replayBuffer.length > this.bufferMax) {
            this.replayBuffer.shift();
            // Reindex terminal indices
            if (this._terminalIndices) {
                for (let i = this._terminalIndices.length - 1; i >= 0; i--) {
                    this._terminalIndices[i]--;
                    if (this._terminalIndices[i] < 0) this._terminalIndices.splice(i, 1);
                }
            }
        }
        // Track terminal transitions for prioritized replay
        if (done) {
            if (!this._terminalIndices) this._terminalIndices = [];
            this._terminalIndices.push(this.replayBuffer.length - 1);
            if (this._terminalIndices.length > 200) this._terminalIndices.shift();
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
        const buf = this.replayBuffer;
        const N = buf.length;

        for (let b = 0; b < this.batchSize; b++) {
            // Prioritized sampling: terminal transitions have 5x weight
            // This helps the agent learn from rare landing/crash events
            let idx;
            if (Math.random() < 0.3 && this._terminalIndices && this._terminalIndices.length > 0) {
                idx = this._terminalIndices[Math.floor(Math.random() * this._terminalIndices.length)];
                if (idx >= N) idx = Math.floor(Math.random() * N);
            } else {
                idx = Math.floor(Math.random() * N);
            }
            const { s, a, r, sNext, done } = buf[idx];

            let maxQ = 0;
            if (!done) {
                // Double DQN
                const { out: qOnline } = this.net.forward(sNext);
                let bestAction = 0;
                for (let i = 1; i < 6; i++) if (qOnline[i] > qOnline[bestAction]) bestAction = i;
                const { out: qTarget } = this.targetNet.forward(sNext);
                maxQ = qTarget[bestAction];
            }
            const targetVal = Math.max(-20, Math.min(20, r + this.gamma * maxQ));

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
        if (d.net) a.net = deserializeNet(d.net);
        if (d.targetNet) a.targetNet = deserializeNet(d.targetNet);
        a.epsilon = d.epsilon || 1.0;
        a.episodes = d.episodes || 0;
        a.landings = d.landings || 0;
        a.totalGames = d.totalGames || 0;
        a.stepCount = d.stepCount || 0;
        return a;
    };

    // ========================================================
    // 2. A2C AGENT — Advantage Actor-Critic
    //    Actor: MiniNet2(8, 48, 32, 6), Critic: MiniNet2(8, 48, 32, 1)
    // ========================================================
    function A2CAgent() {
        this.actor = new MiniNet2(8, 64, 48, 6);
        this.critic = new MiniNet2(8, 64, 48, 1);

        this.gamma = 0.99;
        this.actorLr = 0.0005;
        this.criticLr = 0.001;
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
            return biasedRandomAction();
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
        // Scale rewards for critic stability (terminal rewards are 10-20x per-frame)
        var scaledReward = reward * 0.1;
        this.nStepBuffer.push({ state: state, action: action, reward: scaledReward, nextState: nextState, done: done });

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

        // Compute advantages and normalize them
        const advantages = new Float64Array(T);
        for (let t = 0; t < T; t++) {
            const { out: vCur } = this.critic.forward(buf[t].state);
            advantages[t] = returns[t] - vCur[0];
        }

        // Normalize advantages for stable policy gradients
        if (T > 1) {
            let mean = 0, std = 0;
            for (let t = 0; t < T; t++) mean += advantages[t];
            mean /= T;
            for (let t = 0; t < T; t++) std += (advantages[t] - mean) ** 2;
            std = Math.sqrt(std / T + 1e-8);
            for (let t = 0; t < T; t++) advantages[t] = (advantages[t] - mean) / std;
        }

        // Update actor and critic for each step
        for (let t = 0; t < T; t++) {
            this.critic.trainValue(buf[t].state, returns[t], this.criticLr);
            this.actor.trainPG(buf[t].state, buf[t].action, advantages[t], this.actorLr, this.entropyCoef);
        }

        this.nStepBuffer = [];
    };

    A2CAgent.prototype.onEpisodeEnd = function (result) {
        // Flush any remaining steps in the buffer
        if (this.nStepBuffer.length > 0) {
            this._trainBatch();
        }
        this.nStepBuffer = []; // ensure clean slate
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
        if (d.actor) a.actor = deserializeNet(d.actor);
        if (d.critic) a.critic = deserializeNet(d.critic);
        a.epsilon = d.epsilon !== undefined ? d.epsilon : 0.2;
        a.episodes = d.episodes || 0;
        a.landings = d.landings || 0;
        a.totalGames = d.totalGames || 0;
        return a;
    };

    // ========================================================
    // 3. PPO AGENT — Proximal Policy Optimization
    //    Same architecture as A2C
    // ========================================================
    function PPOAgent() {
        this.actor = new MiniNet2(8, 64, 48, 6);
        this.critic = new MiniNet2(8, 64, 48, 1);
        // PPO uses SGD — Adam destabilizes the clipped objective
        this.actor.useAdam = false;
        this.critic.useAdam = false;

        this.gamma = 0.99;
        this.lam = 0.95;         // GAE lambda
        this.clipEps = 0.2;
        this.actorLr = 0.003;
        this.criticLr = 0.008;
        this.entropyCoef = 0.04;
        this.epochs = 2;
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
            return biasedRandomAction();
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
        // Scale rewards for critic stability
        var scaledReward = reward * 0.1;
        const probs = this.actor.softmax(state);
        const { out: vOut } = this.critic.forward(state);
        this.trajectory.push({
            state: state.slice ? state.slice() : Array.from(state),
            action: action,
            reward: scaledReward,
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
        // Only train when trajectory has enough data for stable updates
        // Done flags within trajectory handle episode boundaries correctly in GAE
        if (this.trajectory.length >= this.trajectoryLen) {
            this.trainOnTrajectory();
        }
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
        if (d.actor) a.actor = deserializeNet(d.actor);
        if (d.critic) a.critic = deserializeNet(d.critic);
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
