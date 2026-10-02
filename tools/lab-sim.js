// Loads the Fun Lab game engines and agents in Node with a stub canvas,
// so the agents can be trained and evaluated offline (see lab-train.js).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LAB = path.join(__dirname, '..', 'lab');

function load(files) {
    const ctx2d = new Proxy({}, { get: () => () => {}, set: () => true });
    const canvas = {
        getContext: () => ctx2d,
        getBoundingClientRect: () => ({ width: 800, height: 600, top: 0, left: 0 }),
        addEventListener() {}
    };
    const sandbox = {
        window: { matchMedia: () => ({ matches: true }), devicePixelRatio: 1, addEventListener() {} },
        document: { addEventListener() {}, documentElement: { getAttribute: () => 'dark' } },
        getComputedStyle: () => ({ getPropertyValue: () => '', backgroundColor: '#000' }),
        Math, console, performance
    };
    vm.createContext(sandbox);
    for (const f of files) {
        // top-level `const X =` is not visible on the sandbox; expose it
        const src = fs.readFileSync(path.join(LAB, f), 'utf8').replace(/^const (\w+) =/m, 'this.$1 =');
        vm.runInContext(src, sandbox, { filename: f });
    }
    sandbox.canvas = canvas;
    return sandbox;
}

module.exports = { load, LAB };
