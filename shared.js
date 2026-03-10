// ========== THEME TOGGLE ==========
(function initTheme() {
    // Theme is set early via inline script in <head> to prevent flash.
    // This just wires up the toggle button and system preference listener.
    const toggle = document.querySelector('.theme-toggle');
    if (!toggle) return;

    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        updateParticleColors();
    }

    toggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        setTheme(current === 'dark' ? 'light' : 'dark');
    });

})();

// ========== PARTICLES ==========
function getParticleColors() {
    const style = getComputedStyle(document.documentElement);
    return [
        style.getPropertyValue('--neon-pink').trim() || '#ff006e',
        style.getPropertyValue('--neon-cyan').trim() || '#00f0ff',
        style.getPropertyValue('--neon-purple').trim() || '#b026ff',
        style.getPropertyValue('--neon-green').trim() || '#39ff14'
    ];
}

function createParticles(count) {
    const container = document.getElementById('particles');
    if (!container) return;
    const colors = getParticleColors();
    for (let i = 0; i < (count || 30); i++) {
        const p = document.createElement('div');
        p.classList.add('particle');
        p.style.left = Math.random() * 100 + '%';
        p.style.top = Math.random() * 100 + '%';
        p.style.animationDelay = Math.random() * 6 + 's';
        p.style.animationDuration = (Math.random() * 4 + 3) + 's';
        const size = Math.random() * 4 + 1;
        p.style.width = size + 'px';
        p.style.height = size + 'px';
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        container.appendChild(p);
    }
}

function updateParticleColors() {
    const colors = getParticleColors();
    document.querySelectorAll('.particle').forEach(p => {
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
    });
}

// ========== NAVBAR SCROLL EFFECT ==========
window.addEventListener('scroll', () => {
    const header = document.querySelector('header');
    if (header) {
        header.classList.toggle('scrolled', window.pageYOffset > 50);
    }
});

// ========== HAMBURGER MENU ==========
document.addEventListener('DOMContentLoaded', () => {
    const hamburger = document.getElementById('hamburger');
    if (hamburger) {
        hamburger.addEventListener('click', () => {
            const navLinks = document.querySelector('.nav-links');
            navLinks.classList.toggle('active');
            hamburger.classList.toggle('active');
            const expanded = navLinks.classList.contains('active');
            hamburger.setAttribute('aria-expanded', expanded);
        });
    }
});

// ========== INTERSECTION OBSERVER (FADE-IN) ==========
const sharedObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('visible');
    });
}, { threshold: 0.1 });
document.querySelectorAll('section').forEach(s => sharedObserver.observe(s));

// ========== CURSOR NEON GLOW ==========
(function initCursorGlow() {
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return;

    const glow = document.createElement('div');
    glow.classList.add('cursor-glow');
    document.body.appendChild(glow);

    let mx = -500, my = -500, cx = -500, cy = -500;

    document.addEventListener('mousemove', (e) => {
        mx = e.clientX;
        my = e.clientY;
    });

    (function animate() {
        cx += (mx - cx) * 0.15;
        cy += (my - cy) * 0.15;
        glow.style.left = cx + 'px';
        glow.style.top = cy + 'px';
        requestAnimationFrame(animate);
    })();
})();

// ========== CLICK RIPPLE ON NEON BUTTONS ==========
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.neon-btn');
    if (!btn) return;

    const ripple = document.createElement('span');
    ripple.classList.add('ripple');
    const rect = btn.getBoundingClientRect();
    ripple.style.left = (e.clientX - rect.left) + 'px';
    ripple.style.top = (e.clientY - rect.top) + 'px';
    btn.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
});

// ========== KANJI PULSE ==========
function initKanjiPulse() {
    const els = document.querySelectorAll('.neon-kanji');
    if (!els.length) return;

    let t = 0;
    function animate() {
        t += 0.015;
        els.forEach((el, i) => {
            const phase = i * 1.3;
            const opacity = 0.04 + 0.03 * Math.sin(t + phase);
            el.style.opacity = opacity.toFixed(3);
        });
        requestAnimationFrame(animate);
    }
    animate();
}

document.addEventListener('DOMContentLoaded', initKanjiPulse);

// ========== LIQUID FLOW ==========
function initLiquidFlow() {
    const turb = document.getElementById('liquid-turbulence');
    if (!turb) return;

    let t = 0;
    function animate() {
        t += 0.003;
        const bx = 0.006 + Math.sin(t * 0.7) * 0.004;
        const by = 0.009 + Math.cos(t * 0.5) * 0.005;
        turb.setAttribute('baseFrequency', bx.toFixed(4) + ' ' + by.toFixed(4));
        requestAnimationFrame(animate);
    }
    animate();
}

document.addEventListener('DOMContentLoaded', initLiquidFlow);
