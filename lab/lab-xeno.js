// ========== LAB XENO: HUD orbital dials ==========
// Purely presentational. Watches the HUD readouts the UI scripts already write
// (#hud-landrate / #hud-winrate / #hud-epsilon) and mirrors each value into a
// --v custom property (0..1) on its .hud-item, which lab-xeno.css draws as a ring.
// No coupling to the game or RL code: if this file is missing, the HUD still works.

(function () {
    'use strict';

    var dials = [
        { id: 'hud-landrate', scale: 100 },
        { id: 'hud-winrate', scale: 100 },
        { id: 'hud-epsilon', scale: 1 }
    ];

    dials.forEach(function (d) {
        var el = document.getElementById(d.id);
        if (!el || !el.parentElement) return;
        var item = el.parentElement;
        item.classList.add('is-dial');

        function sync() {
            var n = parseFloat(el.textContent);
            var v = isFinite(n) ? Math.max(0, Math.min(1, n / d.scale)) : 0;
            item.style.setProperty('--v', v.toFixed(3));
        }
        sync();
        new MutationObserver(sync).observe(el, { childList: true, characterData: true, subtree: true });
    });
})();
