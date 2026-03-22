// ========== LOGO INJECTION ==========
// Single source SVG injected into all pages. Preserves currentColor for theme support.
(function initLogo() {
    var containers = document.querySelectorAll('.logo');
    if (!containers.length) return;

    var scripts = document.querySelectorAll('script[src*="shared.js"]');
    var base = '';
    if (scripts.length) {
        var src = scripts[scripts.length - 1].getAttribute('src');
        base = src.substring(0, src.lastIndexOf('/') + 1);
    }
    var logoURL = base + 'logo.svg';

    fetch(logoURL).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.text();
    }).then(function (svg) {
        containers.forEach(function (el) {
            if (!el.querySelector('svg')) {
                var temp = document.createElement('div');
                temp.innerHTML = svg;
                var svgEl = temp.querySelector('svg');
                if (svgEl) {
                    svgEl.classList.add('logo-mark');
                    el.prepend(svgEl);
                }
            }
        });
    }).catch(function () { /* logo stays as fallback if fetch fails */ });
})();

// ========== THEME TOGGLE ==========
(function initTheme() {
    const toggle = document.querySelector('.theme-toggle');
    if (!toggle) return;

    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }

    toggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        setTheme(current === 'dark' ? 'light' : 'dark');
    });
})();

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

// ========== CURSOR GLOW ==========
(function initCursorGlow() {
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

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
