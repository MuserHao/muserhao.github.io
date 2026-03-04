(function () {
    'use strict';

    if (typeof THREE === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const hero = document.getElementById('home');
    if (!hero) return;

    // ── Canvas ─────────────────────────────────────────────────────────────────
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
    hero.insertBefore(canvas, hero.firstChild);

    function dim() {
        return { w: hero.offsetWidth || window.innerWidth, h: hero.offsetHeight || window.innerHeight };
    }
    let { w: W, h: H } = dim();

    // ── Renderer ───────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 1000);
    camera.position.z = 270;

    // ── Theme-aware colors ─────────────────────────────────────────────────────
    function themeColors() {
        const light = document.documentElement.getAttribute('data-theme') === 'light';
        return {
            nodeBase: light ? new THREE.Color(0xb8d8e8) : new THREE.Color(0x080e1a),
            nodeGlow: light ? new THREE.Color(0x00aabb) : new THREE.Color(0x00f0ff),
            edgeBase: light ? new THREE.Color(0xcce0ec) : new THREE.Color(0x030810),
            edgeGlow: light ? new THREE.Color(0x0088a0) : new THREE.Color(0x0099cc),
        };
    }
    let C = themeColors();

    new MutationObserver(() => { C = themeColors(); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // ── Nodes ──────────────────────────────────────────────────────────────────
    const N = 140;
    const CONN_DIST = 52;
    const SPREAD    = 95;

    // Cube-root sampling fills the volume rather than clustering at centre
    const nodeData = Array.from({ length: N }, () => {
        const u = Math.random(), v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi   = Math.acos(2 * v - 1);
        const r     = SPREAD * Math.cbrt(Math.random());
        return {
            bx: r * Math.sin(phi) * Math.cos(theta),
            by: r * Math.sin(phi) * Math.sin(theta) * 0.62, // squish y → brain-blob shape
            bz: r * Math.cos(phi),
            phase: Math.random() * Math.PI * 2,
            freq:  0.35 + Math.random() * 0.55,
            amp:   2.5  + Math.random() * 4,
            brightness: 0,
        };
    });

    // ── Pre-compute edges ──────────────────────────────────────────────────────
    const edges = [];
    for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
            const a = nodeData[i], b = nodeData[j];
            const dx = a.bx - b.bx, dy = a.by - b.by, dz = a.bz - b.bz;
            if (dx * dx + dy * dy + dz * dz < CONN_DIST * CONN_DIST) edges.push([i, j]);
        }
    }

    // Neighbour map for cascade firing
    const nbr = Array.from({ length: N }, () => []);
    edges.forEach(([i, j]) => { nbr[i].push(j); nbr[j].push(i); });

    // ── BufferGeometry — nodes ─────────────────────────────────────────────────
    const nPos = new Float32Array(N * 3);
    const nCol = new Float32Array(N * 3);
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nPos, 3));
    nodeGeo.setAttribute('color',    new THREE.BufferAttribute(nCol, 3));

    const nodeMesh = new THREE.Points(nodeGeo, new THREE.PointsMaterial({
        size: 3.8, vertexColors: true, transparent: true, opacity: 0.9, sizeAttenuation: true,
    }));
    scene.add(nodeMesh);

    // ── BufferGeometry — edges ─────────────────────────────────────────────────
    const ePos = new Float32Array(edges.length * 6);
    const eCol = new Float32Array(edges.length * 6);
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    edgeGeo.setAttribute('color',    new THREE.BufferAttribute(eCol, 3));

    scene.add(new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.4,
    })));

    // ── Firing system ──────────────────────────────────────────────────────────
    function fireNode(idx, strength) {
        nodeData[idx].brightness = Math.min(1, nodeData[idx].brightness + strength);
    }

    function trigger() {
        const count = 2 + Math.floor(Math.random() * 3);
        for (let k = 0; k < count; k++) {
            const idx = Math.floor(Math.random() * N);
            fireNode(idx, 1.0);
            // Cascade up to 5 neighbours with staggered delay
            nbr[idx].slice(0, 5).forEach((nb, i) => {
                setTimeout(() => fireNode(nb, 0.65), 120 + i * 75);
                // Second-order cascade
                nbr[nb].slice(0, 3).forEach((nb2) => {
                    setTimeout(() => fireNode(nb2, 0.35), 240 + i * 75 + Math.random() * 80);
                });
            });
        }
    }

    trigger();
    setInterval(trigger, 1800);

    // ── Mouse parallax ─────────────────────────────────────────────────────────
    let mx = 0, my = 0, rotX = 0, rotY = 0;
    window.addEventListener('mousemove', e => {
        mx = (e.clientX / window.innerWidth)  * 2 - 1;
        my = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });

    // ── Resize ─────────────────────────────────────────────────────────────────
    window.addEventListener('resize', () => {
        const d = dim();
        W = d.w; H = d.h;
        renderer.setSize(W, H);
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
    }, { passive: true });

    // ── Animation ──────────────────────────────────────────────────────────────
    const tmp = new THREE.Color();
    let t = 0;

    function animate() {
        requestAnimationFrame(animate);
        t += 0.007;

        // Smooth parallax camera lean
        rotY += (mx * 0.28 - rotY) * 0.04;
        rotX += (-my * 0.18 - rotX) * 0.04;
        scene.rotation.y = rotY;
        scene.rotation.x = rotX;

        // Update node positions & colours
        for (let i = 0; i < N; i++) {
            const d = nodeData[i];
            const ph = d.phase + t * d.freq;
            nPos[i*3]     = d.bx + Math.sin(ph * 0.71) * d.amp;
            nPos[i*3 + 1] = d.by + Math.cos(ph * 0.53) * d.amp;
            nPos[i*3 + 2] = d.bz + Math.sin(ph * 0.37) * d.amp;

            d.brightness *= 0.90;   // decay

            tmp.lerpColors(C.nodeBase, C.nodeGlow, Math.pow(d.brightness, 0.6));
            nCol[i*3]     = tmp.r;
            nCol[i*3 + 1] = tmp.g;
            nCol[i*3 + 2] = tmp.b;
        }
        nodeGeo.attributes.position.needsUpdate = true;
        nodeGeo.attributes.color.needsUpdate    = true;

        // Update edge positions & colours
        for (let e = 0; e < edges.length; e++) {
            const [ai, bi] = edges[e];
            ePos[e*6]     = nPos[ai*3];     ePos[e*6 + 1] = nPos[ai*3 + 1]; ePos[e*6 + 2] = nPos[ai*3 + 2];
            ePos[e*6 + 3] = nPos[bi*3];     ePos[e*6 + 4] = nPos[bi*3 + 1]; ePos[e*6 + 5] = nPos[bi*3 + 2];

            const bright = Math.max(nodeData[ai].brightness, nodeData[bi].brightness);
            tmp.lerpColors(C.edgeBase, C.edgeGlow, Math.pow(bright, 0.7));
            eCol[e*6]     = tmp.r; eCol[e*6 + 1] = tmp.g; eCol[e*6 + 2] = tmp.b;
            eCol[e*6 + 3] = tmp.r; eCol[e*6 + 4] = tmp.g; eCol[e*6 + 5] = tmp.b;
        }
        edgeGeo.attributes.position.needsUpdate = true;
        edgeGeo.attributes.color.needsUpdate    = true;

        renderer.render(scene, camera);
    }

    animate();
})();
