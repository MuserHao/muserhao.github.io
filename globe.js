(function () {
    'use strict';

    const container = document.getElementById('globe-container');
    if (!container) return;

    // ── City data ──────────────────────────────────────────────────────────────
    const cities = [
        { name: 'San Francisco', lat: 37.7749,  lng: -122.4194 },
        { name: 'New York',      lat: 40.7128,  lng:  -74.0060 },
        { name: 'London',        lat: 51.5074,  lng:   -0.1278 },
        { name: 'Paris',         lat: 48.8566,  lng:    2.3522 },
        { name: 'Toronto',       lat: 43.6532,  lng:  -79.3832 },
        { name: 'Beijing',       lat: 39.9042,  lng:  116.4074 },
        { name: 'Shanghai',      lat: 31.2304,  lng:  121.4737 },
        { name: 'Tokyo',         lat: 35.6762,  lng:  139.6503 },
        { name: 'Singapore',     lat:  1.3521,  lng:  103.8198 },
        { name: 'Sydney',        lat: -33.8688, lng:  151.2093 },
        { name: 'Zurich',        lat: 47.3769,  lng:    8.5417 },
        { name: 'Berlin',        lat: 52.5200,  lng:   13.4050 },
        { name: 'Montreal',      lat: 45.5017,  lng:  -73.5673 },
        { name: 'Seattle',       lat: 47.6062,  lng: -122.3321 },
        { name: 'Boston',        lat: 42.3601,  lng:  -71.0589 },
    ];

    // ── Renderer ───────────────────────────────────────────────────────────────
    const W = container.clientWidth;
    const H = container.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 2000);
    camera.position.z = 280;

    // ── Lighting rig ───────────────────────────────────────────────────────────
    // Deep fill so the dark side has colour, not pure black
    scene.add(new THREE.AmbientLight(0x0d1b2a, 10));
    scene.add(new THREE.HemisphereLight(0x003366, 0x1a002a, 2.5));

    // Cyan key light — front-right, orbits slowly
    const keyLight = new THREE.PointLight(0x00f0ff, 120, 700);
    keyLight.position.set(180, 80, 200);
    scene.add(keyLight);

    // Pink fill — left side
    const fillLight = new THREE.PointLight(0xff006e, 55, 650);
    fillLight.position.set(-200, -60, 120);
    scene.add(fillLight);

    // Purple rim — behind-top, silhouette halo
    const rimLight = new THREE.PointLight(0xb026ff, 80, 750);
    rimLight.position.set(-80, 220, -180);
    scene.add(rimLight);

    // Gold accent — bottom-front, warm continent glow
    const goldLight = new THREE.PointLight(0xffd600, 40, 550);
    goldLight.position.set(60, -180, 150);
    scene.add(goldLight);

    // ── Custom globe material (renders immediately, no texture required) ────────
    const globeMat = new THREE.MeshPhongMaterial({
        color:             new THREE.Color(0x0d2236),   // deep ocean blue
        emissive:          new THREE.Color(0x040e1a),
        emissiveIntensity: 1.0,
        shininess:         25,
        specular:          new THREE.Color(0x003355),
    });

    // ── ThreeGlobe ─────────────────────────────────────────────────────────────
    const globe = new ThreeGlobe()
        .atmosphereColor('#00f0ff')
        .atmosphereAltitude(0.22)
        .pointsData(cities)
        .pointAltitude(0.02)
        .pointRadius(0.42)
        .pointColor(() => '#00f0ff')
        .pointResolution(8);

    // Inject custom material — gives a solid good-looking globe without textures
    globe.globeMaterial(globeMat);

    scene.add(globe);

    // ── Async texture enhancement ──────────────────────────────────────────────
    // If the CDN texture loads, apply it on top of the existing material.
    // The globe already looks good; this just makes it better.
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';
    loader.load(
        'https://cdn.jsdelivr.net/npm/three-globe@2.30.0/example/img/earth-dark.jpg',
        (tex) => {
            globeMat.map = tex;
            globeMat.needsUpdate = true;
        }
    );

    // ── Neon wireframe grid overlay ────────────────────────────────────────────
    // Visible immediately; doubles as a lat/lng grid aesthetic
    const wireMesh = new THREE.Mesh(
        new THREE.SphereGeometry(101.5, 36, 18),
        new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
            wireframe: true,
            transparent: true,
            opacity: 0.055,
        })
    );
    globe.add(wireMesh);

    // ── Outer glow halo ────────────────────────────────────────────────────────
    globe.add(new THREE.Mesh(
        new THREE.SphereGeometry(109, 32, 16),
        new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
            side: THREE.BackSide,
            transparent: true,
            opacity: 0.045,
        })
    ));

    // ── Arcs ───────────────────────────────────────────────────────────────────
    function randomArcSet(count) {
        const out = [];
        for (let i = 0; i < count; i++) {
            const src = cities[Math.floor(Math.random() * cities.length)];
            let dst;
            do { dst = cities[Math.floor(Math.random() * cities.length)]; } while (dst === src);
            out.push({
                startLat: src.lat, startLng: src.lng,
                endLat:   dst.lat, endLng:   dst.lng,
                color: Math.random() > 0.5 ? '#00f0ff' : '#ffd600',
            });
        }
        return out;
    }

    function refreshArcs() {
        globe
            .arcsData(randomArcSet(6))
            .arcColor('color')
            .arcAltitude(0.3)
            .arcStroke(0.6)
            .arcDashLength(0.45)
            .arcDashGap(0.2)
            .arcDashAnimateTime(1800);
    }

    refreshArcs();
    setInterval(refreshArcs, 4000);

    // ── Drag rotation ──────────────────────────────────────────────────────────
    let isDragging = false;
    let prevMouse  = { x: 0, y: 0 };
    let rotVel     = { x: 0, y: 0 };

    function onDown(cx, cy) { isDragging = true; prevMouse = { x: cx, y: cy }; rotVel = { x: 0, y: 0 }; }
    function onMove(cx, cy) {
        if (!isDragging) return;
        rotVel.y = (cx - prevMouse.x) * 0.005;
        rotVel.x = (cy - prevMouse.y) * 0.005;
        globe.rotation.y += rotVel.y;
        globe.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, globe.rotation.x + rotVel.x));
        prevMouse = { x: cx, y: cy };
    }
    function onUp() { isDragging = false; }

    renderer.domElement.addEventListener('mousedown',  e => onDown(e.clientX, e.clientY));
    renderer.domElement.addEventListener('mousemove',  e => onMove(e.clientX, e.clientY));
    renderer.domElement.addEventListener('mouseup',    onUp);
    renderer.domElement.addEventListener('mouseleave', onUp);
    renderer.domElement.addEventListener('touchstart', e => onDown(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    renderer.domElement.addEventListener('touchmove',  e => onMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    renderer.domElement.addEventListener('touchend',   onUp);

    // ── Responsive resize ──────────────────────────────────────────────────────
    new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }).observe(container);

    // ── Animation loop ─────────────────────────────────────────────────────────
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const AUTO_ROT = 0.0015;
    let lightAngle = 0;

    function animate() {
        requestAnimationFrame(animate);

        if (!prefersReduced) {
            if (!isDragging) {
                globe.rotation.y += AUTO_ROT;
                rotVel.x *= 0.92;
                rotVel.y *= 0.92;
                globe.rotation.y  += rotVel.y;
                globe.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, globe.rotation.x + rotVel.x));
            }
            // Key light orbits slowly — shifting cyan highlights across continents
            lightAngle += 0.004;
            keyLight.position.x = Math.cos(lightAngle) * 220;
            keyLight.position.z = Math.sin(lightAngle) * 220;
        }

        renderer.render(scene, camera);
    }
    animate();
})();
