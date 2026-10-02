// Usage: node tools/lander-eval.js <algo> <steps> [out.json]
// Trains one Lunar Lander agent offline, printing landing rates per level.
const { load } = require('./lab-sim');
const sb = load(['tiny-nn.js', 'lander-engine.js', 'lander-rl.js']);
const engine = sb.LanderEngine.create(sb.canvas);
const RL = sb.LanderRL;

function makeRunner(agent) {
    let prev = null, result = null, learn = true;
    engine.setOnStepDone((s, r, done, res) => {
        if (learn && prev) agent.observe(prev.s, prev.a, r, s, done);
        if (done) { result = res; prev = null; return; }
        const a = agent.act(s);
        engine.setAction(a);
        prev = { s, a };
    });
    engine.setOnEpisodeEnd(() => {});
    return {
        episode(level, doLearn) {
            learn = doLearn;
            engine.setWindEnabled(level >= 3);
            engine.generateTerrain();
            engine.spawnLander(level);
            result = null; prev = null;
            // first action from the spawn state
            const s0 = engine.getState();
            const a0 = agent.act(s0); engine.setAction(a0); prev = { s: s0, a: a0 };
            let n = 0;
            while (!result) { engine.stepAgent(); n++; }
            return { result, steps: n };
        }
    };
}

function evaluate(agent, runner, n) {
    const out = [];
    const eps = agent.epsilon;
    if (eps !== undefined) agent.epsilon = 0.0;
    for (let lv = 0; lv < 4; lv++) {
        const c = {};
        for (let i = 0; i < n; i++) { const r = runner.episode(lv, false).result; c[r] = (c[r] || 0) + 1; }
        out.push(Math.round((c.landed || 0) / n * 100) + '%' + (c.timeout ? '(t' + c.timeout + ')' : ''));
    }
    if (eps !== undefined) agent.epsilon = eps;
    evaluate.last = out.reduce((t, x) => t + parseInt(x, 10), 0) / out.length;
    return out.join(' ');
}

module.exports = { engine, RL, makeRunner, evaluate };

if (require.main === module) {
    const algo = process.argv[2], budget = +process.argv[3] || 300000;
    const agent = RL.create(algo);
    const runner = makeRunner(agent);
    let steps = 0, next = 50000, best = null, bestScore = -1; const t0 = Date.now();
    while (steps < budget) {
        const lv = Math.floor(Math.random() * 4);
        const r = runner.episode(lv, true);
        agent.endEpisode(r.result);
        steps += r.steps;
        if (steps >= next) {
            next += 50000;
            console.log(algo, (steps / 1000 | 0) + 'k steps', agent.episodes + ' ep', ((Date.now() - t0) / 1000 | 0) + 's', 'land E/M/H/F', evaluate(agent, runner, 50));
            if (evaluate.last >= bestScore) { bestScore = evaluate.last; best = JSON.stringify(agent.serialize()); }
        }
    }
    // Keep the best checkpoint seen (evaluation is noisy, training can regress)
    if (process.argv[4]) require('fs').writeFileSync(process.argv[4], best || JSON.stringify(agent.serialize()));
}
