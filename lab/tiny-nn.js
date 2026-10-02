// ========== TINY NN ==========
// A small multi-layer perceptron with mini-batch gradients and Adam, shared by
// the Fun Lab agents. Plain JS, no dependencies, runs in the browser and Node.
//
//   const net = new TinyNN.MLP([8, 64, 64, 6]);
//   const { out, acts } = net.forward(x);    // ReLU hidden layers, linear output
//   net.backward(acts, dOut);                 // accumulate dLoss/dOut for one sample
//   net.step(3e-4);                           // average the batch, one Adam update

const TinyNN = (function () {
    'use strict';

    function randn() {
        // Box-Muller transform
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    // sizes: [nIn, h1, ..., nOut]. outScale shrinks the last layer's init,
    // which keeps a fresh policy close to uniform (standard for PPO).
    function MLP(sizes, outScale) {
        this.sizes = sizes.slice();
        this.W = []; this.b = [];
        this.gW = []; this.gB = [];
        this.mW = []; this.vW = []; this.mB = []; this.vB = [];
        for (let l = 0; l < sizes.length - 1; l++) {
            const nIn = sizes[l], nOut = sizes[l + 1];
            const last = l === sizes.length - 2;
            const scale = Math.sqrt(2.0 / nIn) * (last && outScale ? outScale : 1); // He init
            const w = new Float64Array(nIn * nOut);
            for (let i = 0; i < w.length; i++) w[i] = randn() * scale;
            this.W.push(w);
            this.b.push(new Float64Array(nOut));
        }
        this._initOptimizer();
    }

    MLP.prototype._initOptimizer = function () {
        this.gW = this.W.map(w => new Float64Array(w.length));
        this.gB = this.b.map(b => new Float64Array(b.length));
        this.mW = this.W.map(w => new Float64Array(w.length));
        this.vW = this.W.map(w => new Float64Array(w.length));
        this.mB = this.b.map(b => new Float64Array(b.length));
        this.vB = this.b.map(b => new Float64Array(b.length));
        this.t = 0;
        this.nAcc = 0;
    };

    MLP.prototype.paramCount = function () {
        let n = 0;
        for (let l = 0; l < this.W.length; l++) n += this.W[l].length + this.b[l].length;
        return n;
    };

    // Returns the output and every layer's activations (needed by backward)
    MLP.prototype.forward = function (x) {
        const acts = [x];
        let a = x;
        const L = this.W.length;
        for (let l = 0; l < L; l++) {
            const nIn = this.sizes[l], nOut = this.sizes[l + 1];
            const w = this.W[l], bias = this.b[l];
            const z = new Float64Array(nOut);
            for (let j = 0; j < nOut; j++) z[j] = bias[j];
            for (let i = 0; i < nIn; i++) {
                const ai = a[i];
                if (ai === 0) continue;
                const row = i * nOut;
                for (let j = 0; j < nOut; j++) z[j] += ai * w[row + j];
            }
            if (l < L - 1) for (let j = 0; j < nOut; j++) if (z[j] < 0) z[j] = 0; // ReLU
            acts.push(z);
            a = z;
        }
        return { out: a, acts };
    };

    MLP.prototype.predict = function (x) { return this.forward(x).out; };

    // Accumulate gradients for one sample, given dLoss/dOutput
    MLP.prototype.backward = function (acts, dOut) {
        let delta = dOut;
        for (let l = this.W.length - 1; l >= 0; l--) {
            const nIn = this.sizes[l], nOut = this.sizes[l + 1];
            const aIn = acts[l], w = this.W[l], gw = this.gW[l], gb = this.gB[l];
            for (let j = 0; j < nOut; j++) gb[j] += delta[j];
            let dPrev = null;
            if (l > 0) dPrev = new Float64Array(nIn);
            for (let i = 0; i < nIn; i++) {
                const ai = aIn[i], row = i * nOut;
                let s = 0;
                for (let j = 0; j < nOut; j++) {
                    gw[row + j] += ai * delta[j];
                    s += w[row + j] * delta[j];
                }
                if (dPrev) dPrev[i] = aIn[i] > 0 ? s : 0; // ReLU derivative
            }
            delta = dPrev;
        }
        this.nAcc++;
    };

    // Average the accumulated batch gradient, clip its global norm, apply Adam
    MLP.prototype.step = function (lr, maxNorm) {
        if (this.nAcc === 0) return;
        const inv = 1 / this.nAcc;
        let sq = 0;
        for (let l = 0; l < this.W.length; l++) {
            const gw = this.gW[l], gb = this.gB[l];
            for (let i = 0; i < gw.length; i++) { gw[i] *= inv; sq += gw[i] * gw[i]; }
            for (let i = 0; i < gb.length; i++) { gb[i] *= inv; sq += gb[i] * gb[i]; }
        }
        const norm = Math.sqrt(sq);
        const clip = maxNorm && norm > maxNorm ? maxNorm / norm : 1;

        this.t++;
        const b1 = 0.9, b2 = 0.999, eps = 1e-8;
        const c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
        const update = (p, g, m, v) => {
            for (let i = 0; i < p.length; i++) {
                const gi = g[i] * clip;
                m[i] = b1 * m[i] + (1 - b1) * gi;
                v[i] = b2 * v[i] + (1 - b2) * gi * gi;
                p[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + eps);
                g[i] = 0;
            }
        };
        for (let l = 0; l < this.W.length; l++) {
            update(this.W[l], this.gW[l], this.mW[l], this.vW[l]);
            update(this.b[l], this.gB[l], this.mB[l], this.vB[l]);
        }
        this.nAcc = 0;
        return norm;
    };

    MLP.prototype.copyFrom = function (other) {
        for (let l = 0; l < this.W.length; l++) {
            this.W[l].set(other.W[l]);
            this.b[l].set(other.b[l]);
        }
    };

    // Weights only (optimizer state is rebuilt on load). Rounded to keep files small.
    MLP.prototype.serialize = function () {
        const r = a => Array.from(a, v => Math.round(v * 1e5) / 1e5);
        return { sizes: this.sizes, W: this.W.map(r), b: this.b.map(r) };
    };

    MLP.deserialize = function (d) {
        const net = new MLP(d.sizes);
        net.W = d.W.map(a => new Float64Array(a));
        net.b = d.b.map(a => new Float64Array(a));
        net._initOptimizer();
        return net;
    };

    // ---- helpers ----
    function softmax(logits) {
        let max = -Infinity;
        for (let k = 0; k < logits.length; k++) if (logits[k] > max) max = logits[k];
        const p = new Float64Array(logits.length);
        let sum = 0;
        for (let k = 0; k < logits.length; k++) { p[k] = Math.exp(logits[k] - max); sum += p[k]; }
        for (let k = 0; k < logits.length; k++) p[k] /= sum;
        return p;
    }

    function sample(probs) {
        const r = Math.random();
        let c = 0;
        for (let k = 0; k < probs.length; k++) { c += probs[k]; if (r < c) return k; }
        return probs.length - 1;
    }

    function argmax(a) {
        let best = 0;
        for (let k = 1; k < a.length; k++) if (a[k] > a[best]) best = k;
        return best;
    }

    // Gradient of  -[A·log π(a) + β·H(π)]  w.r.t. the logits (we minimise this)
    function policyGradLogits(probs, action, advantage, entropyCoef) {
        let H = 0;
        for (let k = 0; k < probs.length; k++) if (probs[k] > 1e-12) H -= probs[k] * Math.log(probs[k]);
        const d = new Float64Array(probs.length);
        for (let k = 0; k < probs.length; k++) {
            const logP = Math.log(Math.max(probs[k], 1e-12));
            const dLogPi = (k === action ? 1 : 0) - probs[k];   // d log π(a) / d z_k
            const dH = -probs[k] * (logP + H);                    // d H / d z_k
            d[k] = -(advantage * dLogPi + entropyCoef * dH);
        }
        return d;
    }

    return { MLP, softmax, sample, argmax, policyGradLogits, randn };
})();

if (typeof module !== 'undefined') module.exports = TinyNN;
