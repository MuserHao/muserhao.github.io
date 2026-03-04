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

    // ── Seeded Perlin noise (fixed seed = same "planet" every load) ────────────
    const PERM = new Uint8Array(512);
    (function () {
        // LCG for deterministic shuffle — seed 1337
        let s = 1337;
        function rnd() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; }
        const arr = new Uint8Array(256);
        for (let i = 0; i < 256; i++) arr[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        }
        for (let i = 0; i < 512; i++) PERM[i] = arr[i & 255];
    })();

    const G2 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
    function fade(t) { return t*t*t*(t*(t*6-15)+10); }
    function lerp(a, b, t) { return a + t*(b-a); }
    function dot2(g, x, y) { return g[0]*x + g[1]*y; }
    function pnoise(x, y) {
        const X=Math.floor(x)&255, Y=Math.floor(y)&255;
        const xf=x-Math.floor(x), yf=y-Math.floor(y);
        const u=fade(xf), v=fade(yf);
        const aa=PERM[PERM[X]+Y],   ab=PERM[PERM[X]+Y+1];
        const ba=PERM[PERM[X+1]+Y], bb=PERM[PERM[X+1]+Y+1];
        return lerp(
            lerp(dot2(G2[aa&7],xf,yf),   dot2(G2[ba&7],xf-1,yf),   u),
            lerp(dot2(G2[ab&7],xf,yf-1), dot2(G2[bb&7],xf-1,yf-1), u), v
        );
    }
    // Fractal Brownian Motion — 6 octaves gives fractal coastlines
    function fbm(x, y) {
        let v=0, amp=0.5, freq=1;
        for (let i=0; i<6; i++) { v += pnoise(x*freq, y*freq)*amp; amp*=0.5; freq*=2.05; }
        return v;
    }

    // ── Procedural earth texture ───────────────────────────────────────────────
    // Equirectangular projection: x=longitude (0→2π), y=latitude (π/2→-π/2)
    // Palette: deep navy ocean / dark olive land / pale polar ice
    function makeEarthTexture() {
        const W = 512, H = 256;
        const cvs = document.createElement('canvas');
        cvs.width = W; cvs.height = H;
        const ctx = cvs.getContext('2d');
        const img = ctx.createImageData(W, H);

        for (let py = 0; py < H; py++) {
            const lat = (0.5 - py / H) * Math.PI;            // +π/2 (N) → -π/2 (S)
            const poleFactor = Math.max(0, (Math.abs(lat) - 1.1) / (Math.PI/2 - 1.1));

            for (let px = 0; px < W; px++) {
                const terrain = fbm(px * 0.032, py * 0.048);  // slightly anisotropic

                let r, g, b;
                if (poleFactor > 0.25) {
                    // Polar ice caps — blue-white
                    const ic = Math.floor(150 + poleFactor * 80);
                    r = ic - 10; g = ic; b = ic + 15;
                } else if (terrain > 0.10) {
                    // Land — dark olive / forest green
                    const sh = Math.floor(Math.min((terrain - 0.10) * 55, 35));
                    r = 18 + sh; g = 35 + sh; b = 12 + sh;
                } else {
                    // Ocean — dark navy blue, slightly deeper in troughs
                    const depth = Math.floor((0.10 - terrain) * 25);
                    r = 6; g = 16 + depth; b = 44 + depth;
                }

                const idx = (py * W + px) * 4;
                img.data[idx]     = r;
                img.data[idx + 1] = g;
                img.data[idx + 2] = b;
                img.data[idx + 3] = 255;
            }
        }

        ctx.putImageData(img, 0, 0);
        return new THREE.CanvasTexture(cvs);
    }

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
    scene.add(new THREE.AmbientLight(0x0d1b2a, 10));
    scene.add(new THREE.HemisphereLight(0x003366, 0x1a002a, 2.5));

    const keyLight = new THREE.PointLight(0x00f0ff, 120, 700);
    keyLight.position.set(180, 80, 200);
    scene.add(keyLight);

    const fillLight = new THREE.PointLight(0xff006e, 55, 650);
    fillLight.position.set(-200, -60, 120);
    scene.add(fillLight);

    const rimLight = new THREE.PointLight(0xb026ff, 80, 750);
    rimLight.position.set(-80, 220, -180);
    scene.add(rimLight);

    const goldLight = new THREE.PointLight(0xffd600, 40, 550);
    goldLight.position.set(60, -180, 150);
    scene.add(goldLight);

    // ── Globe material — procedural texture is shown immediately ──────────────
    // Real NASA/Three.js textures load async and upgrade it transparently.
    const globeMat = new THREE.MeshPhongMaterial({
        map:               makeEarthTexture(),   // instant fallback, always visible
        color:             new THREE.Color(0xffffff),
        emissive:          new THREE.Color(0x040e1a),
        emissiveIntensity: 0.4,
        shininess:         20,
        specular:          new THREE.Color(0x004488),
    });

    // ── Async real-texture upgrade ─────────────────────────────────────────────
    // Priority chain: three.js GitHub raw → NASA Earth Observatory fallback.
    // If both fail the procedural map is still perfectly visible.
    (function loadTextures() {
        const loader = new THREE.TextureLoader();
        loader.crossOrigin = 'anonymous';

        const DAY_URLS = [
            'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg',
            'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_cloud_2048.jpg',
        ];
        const LIGHTS_URL =
            'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_lights_2048.png';

        function tryDay(idx) {
            if (idx >= DAY_URLS.length) return;
            loader.load(
                DAY_URLS[idx],
                (tex) => {
                    // Real texture loaded — swap out the procedural one
                    globeMat.map = tex;
                    globeMat.emissiveIntensity = 0;   // reset; night lights handle dark side
                    globeMat.needsUpdate = true;

                    // Now layer the city-lights emissive map on the night side
                    loader.load(LIGHTS_URL, (lightTex) => {
                        globeMat.emissiveMap       = lightTex;
                        globeMat.emissive          = new THREE.Color(0xffffff);
                        globeMat.emissiveIntensity = 0.55;
                        globeMat.needsUpdate       = true;
                    });
                },
                undefined,
                () => tryDay(idx + 1)   // try next URL on error
            );
        }
        tryDay(0);
    })();

    // ── ThreeGlobe ─────────────────────────────────────────────────────────────
    const globe = new ThreeGlobe()
        .atmosphereColor('#00f0ff')
        .atmosphereAltitude(0.22)
        .pointsData(cities)
        .pointAltitude(0.02)
        .pointRadius(0.42)
        .pointColor(() => '#00f0ff')
        .pointResolution(8);

    globe.globeMaterial(globeMat);
    scene.add(globe);

    // ── Neon wireframe grid overlay ────────────────────────────────────────────
    globe.add(new THREE.Mesh(
        new THREE.SphereGeometry(101.5, 36, 18),
        new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: true, transparent: true, opacity: 0.04 })
    ));

    // ── Outer glow halo ────────────────────────────────────────────────────────
    globe.add(new THREE.Mesh(
        new THREE.SphereGeometry(109, 32, 16),
        new THREE.MeshBasicMaterial({ color: 0x00f0ff, side: THREE.BackSide, transparent: true, opacity: 0.04 })
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
    let isDragging = false, prevMouse = {x:0,y:0}, rotVel = {x:0,y:0};
    function onDown(cx,cy) { isDragging=true; prevMouse={x:cx,y:cy}; rotVel={x:0,y:0}; }
    function onMove(cx,cy) {
        if (!isDragging) return;
        rotVel.y = (cx-prevMouse.x)*0.005;
        rotVel.x = (cy-prevMouse.y)*0.005;
        globe.rotation.y += rotVel.y;
        globe.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, globe.rotation.x+rotVel.x));
        prevMouse = {x:cx,y:cy};
    }
    function onUp() { isDragging=false; }

    renderer.domElement.addEventListener('mousedown',  e => onDown(e.clientX,e.clientY));
    renderer.domElement.addEventListener('mousemove',  e => onMove(e.clientX,e.clientY));
    renderer.domElement.addEventListener('mouseup',    onUp);
    renderer.domElement.addEventListener('mouseleave', onUp);
    renderer.domElement.addEventListener('touchstart', e => onDown(e.touches[0].clientX,e.touches[0].clientY), {passive:true});
    renderer.domElement.addEventListener('touchmove',  e => onMove(e.touches[0].clientX,e.touches[0].clientY), {passive:true});
    renderer.domElement.addEventListener('touchend',   onUp);

    // ── Responsive resize ──────────────────────────────────────────────────────
    new ResizeObserver(() => {
        const w = container.clientWidth, h = container.clientHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }).observe(container);

    // ── Animation loop ─────────────────────────────────────────────────────────
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let lightAngle = 0;

    function animate() {
        requestAnimationFrame(animate);
        if (!prefersReduced) {
            if (!isDragging) {
                globe.rotation.y += 0.0015;
                rotVel.x *= 0.92; rotVel.y *= 0.92;
                globe.rotation.y  += rotVel.y;
                globe.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, globe.rotation.x+rotVel.x));
            }
            lightAngle += 0.004;
            keyLight.position.x = Math.cos(lightAngle) * 220;
            keyLight.position.z = Math.sin(lightAngle) * 220;
        }
        renderer.render(scene, camera);
    }
    animate();
})();
