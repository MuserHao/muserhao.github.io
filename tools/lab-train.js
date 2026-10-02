// Pretrains every Fun Lab agent offline and writes the weights the pages load:
//   lab/weights/lander.json  { dqn, a2c, ppo }
//   lab/weights/pong.json    { qlearning, dqn, reinforce }
//
// Usage: node tools/lab-train.js            (all agents, in parallel, ~15 min)
//        node tools/lab-train.js lander ppo  (just one)
// Each run keeps its best checkpoint by evaluation score.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RUNS = {
    lander: { script: 'lander-eval.js', budgets: { dqn: 1500000, a2c: 1500000, ppo: 1500000 } },
    pong:   { script: 'pong-eval.js',   budgets: { qlearning: 3000, dqn: 2000, reinforce: 2000 } }
};

const [onlyGame, onlyAlgo] = process.argv.slice(2);
const outDir = path.join(__dirname, '..', 'lab', 'weights');
fs.mkdirSync(outDir, { recursive: true });

function run(game, algo) {
    const { script, budgets } = RUNS[game];
    const tmp = path.join(os.tmpdir(), `lab-${game}-${algo}.json`);
    return new Promise((resolve, reject) => {
        const child = execFile('node', [path.join(__dirname, script), algo, String(budgets[algo]), tmp],
            { maxBuffer: 1 << 26 }, err => (err ? reject(err) : resolve(JSON.parse(fs.readFileSync(tmp, 'utf8')))));
        child.stdout.on('data', d => process.stdout.write(d));
    });
}

(async () => {
    for (const game of Object.keys(RUNS)) {
        if (onlyGame && game !== onlyGame) continue;
        const file = path.join(outDir, game + '.json');
        const weights = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
        const algos = Object.keys(RUNS[game].budgets).filter(a => !onlyAlgo || a === onlyAlgo);
        const results = await Promise.all(algos.map(a => run(game, a)));
        algos.forEach((a, i) => { weights[a] = results[i]; });
        fs.writeFileSync(file, JSON.stringify(weights));
        console.log('wrote', file);
    }
})();
