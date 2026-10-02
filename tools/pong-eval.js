// Usage: node tools/pong-eval.js <algo> <games> [out.json]
// Trains one Pong agent offline against a scripted bot, printing win rates.
const { load } = require('./lab-sim');
const sb = load(['tiny-nn.js', 'pong-engine.js', 'pong-rl.js']);
const engine = sb.PongEngine.create(sb.canvas);
const RL = sb.PongRL;

// Scripted opponent: strength 0 = slow and noisy, 1 = near perfect (same as the page's bot)
function botMove(strength) {
    const ball = engine.getBall(), H = engine.getH();
    const target = ball.y + (Math.random() - 0.5) * (1 - strength) * 60;
    const pY = engine.getState()[5] * H;
    const diff = target - pY;
    engine.setPlayerY(pY + Math.sign(diff) * Math.min(Math.abs(diff), 1.5 + strength * 4.5));
}

function makeRunner(agent) {
    let prev = null, winner = null, learn = true;
    engine.setOnStepDone((s, d, r, done) => {
        const obs = { s, d };
        const terminal = done || Math.abs(r) >= 1;     // a point ends the rally
        if (learn && prev) agent.observe(prev.obs, prev.a, r, obs, terminal);
        const a = agent.act(obs);
        engine.setAIAction(a);
        prev = terminal ? null : { obs, a };
    });
    engine.setOnRoundEnd(w => { winner = w; });
    return {
        game(strength, doLearn) {
            learn = doLearn; winner = null; prev = null;
            engine.reset();
            let n = 0;
            while (!winner) { botMove(strength); engine.step(); n++; }
            return { winner, steps: n };
        }
    };
}

function evaluate(agent, runner, n) {
    const eps = agent.epsilon;
    if (eps !== undefined) agent.epsilon = 0;
    const out = [];
    for (const st of [0.3, 0.6, 0.9]) {
        let w = 0;
        for (let i = 0; i < n; i++) if (runner.game(st, false).winner === 'ai') w++;
        out.push(Math.round(w / n * 100) + '%');
    }
    if (eps !== undefined) agent.epsilon = eps;
    evaluate.last = out.reduce((t, x) => t + parseInt(x, 10), 0) / out.length;
    return out.join(' ');
}

module.exports = { engine, RL, makeRunner, evaluate, botMove };

if (require.main === module) {
    const algo = process.argv[2], games = +process.argv[3] || 500;
    const agent = RL.create(algo);
    const runner = makeRunner(agent);
    const t0 = Date.now();
    let best = null, bestScore = -1;
    for (let g = 1; g <= games; g++) {
        const r = runner.game(0.2 + Math.random() * 0.8, true);
        agent.endEpisode(r.winner);
        if (g % Math.max(1, games / 10 | 0) === 0)
        {
            console.log(algo, g + ' games', ((Date.now() - t0) / 1000 | 0) + 's', 'win vs bot .3/.6/.9', evaluate(agent, runner, 20));
            if (evaluate.last >= bestScore) { bestScore = evaluate.last; best = JSON.stringify(agent.serialize()); if (process.argv[4]) require('fs').writeFileSync(process.argv[4], best); }
        }
    }
    // Keep the best checkpoint seen (evaluation is noisy, training can regress)
    if (process.argv[4]) require('fs').writeFileSync(process.argv[4], best || JSON.stringify(agent.serialize()));
}
