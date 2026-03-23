(function () {
    'use strict';

    if (typeof THREE === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Dark-theme only — neural network doesn't belong in the atelier
    function isDark() {
        return document.documentElement.getAttribute('data-theme') !== 'light';
    }

    const hero = document.getElementById('home');
    if (!hero) return;

    // ── Canvas ─────────────────────────────────────────────────────────────────
    const canvas = document.createElement('canvas');
    canvas.classList.add('neural-net-canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
    hero.insertBefore(canvas, hero.firstChild);

    // Hide/show based on theme
    function updateVisibility() {
        canvas.style.display = isDark() ? '' : 'none';
    }
    updateVisibility();

    new MutationObserver(() => {
        updateVisibility();
        C = themeColors();
        haloMat.blending = C.blending; haloMat.needsUpdate = true;
        coreMat.blending = C.blending; coreMat.needsUpdate = true;
        edgeMat.blending = C.blending; edgeMat.needsUpdate = true;
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

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
    camera.position.z = 230;   // closer → nodes appear larger

    // ── Theme-aware colors & blending ──────────────────────────────────────────
    // Dark:  AdditiveBlending — overlapping glows accumulate to electric brightness.
    //        Base nodes are dim-but-visible navy; firing nodes pop to bright cyan.
    // Light: NormalBlending — additive on white bg cancels out (adds to white = white).
    //        Base nodes are medium teal; firing pops to bright cyan.
    function themeColors() {
        const light = document.documentElement.getAttribute('data-theme') === 'light';
        return {
            nodeBase: light ? new THREE.Color(0x4a9ab0) : new THREE.Color(0x1a4a60),
            nodeGlow: light ? new THREE.Color(0x00c8d8) : new THREE.Color(0x00f0ff),
            edgeBase: light ? new THREE.Color(0x3a7a90) : new THREE.Color(0x0d3a50),
            edgeGlow: light ? new THREE.Color(0x00a0b8) : new THREE.Color(0x00b8e0),
            blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
        };
    }
    let C = themeColors();

    // ── Nodes ──────────────────────────────────────────────────────────────────
    const N         = 200;   // more nodes = denser, more impressive lattice
    const CONN_DIST = 65;    // wider threshold = more connections
    const SPREAD    = 120;

    const nodeData = Array.from({ length: N }, () => {
        const u = Math.random(), v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi   = Math.acos(2 * v - 1);
        const r     = SPREAD * Math.cbrt(Math.random()); // volume-fill distribution
        return {
            bx: r * Math.sin(phi) * Math.cos(theta),
            by: r * Math.sin(phi) * Math.sin(theta) * 0.6,  // squished = oblate brain shape
            bz: r * Math.cos(phi),
            phase: Math.random() * Math.PI * 2,
            freq:  0.3  + Math.random() * 0.5,
            amp:   2.5  + Math.random() * 4.5,
            brightness: 0,
        };
    });

    // ── Pre-compute edges ──────────────────────────────────────────────────────
    const edges = [];
    const CONN_SQ = CONN_DIST * CONN_DIST;
    for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
            const a = nodeData[i], b = nodeData[j];
            const dx = a.bx - b.bx, dy = a.by - b.by, dz = a.bz - b.bz;
            if (dx*dx + dy*dy + dz*dz < CONN_SQ) edges.push([i, j]);
        }
    }

    const nbr = Array.from({ length: N }, () => []);
    edges.forEach(([i, j]) => { nbr[i].push(j); nbr[j].push(i); });

    // ── Shared BufferGeometry (both render passes share same positions) ─────────
    const nPos = new Float32Array(N * 3);
    const nCol = new Float32Array(N * 3);
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nPos, 3));
    nodeGeo.setAttribute('color',    new THREE.BufferAttribute(nCol, 3));

    // Pass 1 — soft glow halo (large radius, very low opacity)
    // With AdditiveBlending, nearby halos overlap and brighten each other,
    // making dense areas of the network appear to glow.
    const haloMat = new THREE.PointsMaterial({
        size: 24, vertexColors: true, transparent: true, opacity: 0.07,
        sizeAttenuation: true, blending: C.blending, depthWrite: false,
    });
    scene.add(new THREE.Points(nodeGeo, haloMat));

    // Pass 2 — bright core dot
    const coreMat = new THREE.PointsMaterial({
        size: 5.5, vertexColors: true, transparent: true, opacity: 0.95,
        sizeAttenuation: true, blending: C.blending, depthWrite: false,
    });
    scene.add(new THREE.Points(nodeGeo, coreMat));

    // ── Edges ──────────────────────────────────────────────────────────────────
    const ePos = new Float32Array(edges.length * 6);
    const eCol = new Float32Array(edges.length * 6);
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    edgeGeo.setAttribute('color',    new THREE.BufferAttribute(eCol, 3));

    const edgeMat = new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.55,
        blending: C.blending, depthWrite: false,
    });
    scene.add(new THREE.LineSegments(edgeGeo, edgeMat));

    // ── Firing system ──────────────────────────────────────────────────────────
    // decay = 0.968 → after 1.5s (90 frames at 60fps): 0.968^90 ≈ 0.05
    // Firing is clearly visible for about 1.5 seconds before fading out.
    const DECAY = 0.968;

    function fireNode(idx, strength) {
        nodeData[idx].brightness = Math.min(1, nodeData[idx].brightness + strength);
    }

    function trigger() {
        const count = 4 + Math.floor(Math.random() * 3);  // 4–6 nodes per burst
        for (let k = 0; k < count; k++) {
            const idx = Math.floor(Math.random() * N);
            fireNode(idx, 1.0);
            nbr[idx].slice(0, 6).forEach((nb, i) => {
                setTimeout(() => {
                    fireNode(nb, 0.7);
                    // Second-order cascade
                    nbr[nb].slice(0, 4).forEach((nb2, j) => {
                        setTimeout(() => fireNode(nb2, 0.4), 100 + j * 60);
                    });
                }, 100 + i * 70);
            });
        }
    }

    trigger();
    setInterval(trigger, 1200);   // every 1.2s (was 1.8s)

    // ── Mouse parallax ─────────────────────────────────────────────────────────
    let mx = 0, my = 0, rotX = 0, rotY = 0;
    window.addEventListener('mousemove', e => {
        mx = (e.clientX / window.innerWidth)  * 2 - 1;
        my = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });

    // ── Resize ─────────────────────────────────────────────────────────────────
    window.addEventListener('resize', () => {
        const d = dim(); W = d.w; H = d.h;
        renderer.setSize(W, H);
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
    }, { passive: true });

    // ── Animation ──────────────────────────────────────────────────────────────
    const tmp = new THREE.Color();
    let t = 0;

    function animate() {
        requestAnimationFrame(animate);

        // Skip rendering in light theme
        if (!isDark()) return;

        t += 0.007;

        // Mouse parallax + slow auto-drift so the network is always in motion
        rotY += (mx * 0.32 - rotY) * 0.04;
        rotX += (-my * 0.20 - rotX) * 0.04;
        scene.rotation.y = rotY + t * 0.06;   // slow continuous y-rotation
        scene.rotation.x = rotX;

        for (let i = 0; i < N; i++) {
            const d = nodeData[i];
            const ph = d.phase + t * d.freq;
            nPos[i*3]     = d.bx + Math.sin(ph * 0.71) * d.amp;
            nPos[i*3 + 1] = d.by + Math.cos(ph * 0.53) * d.amp;
            nPos[i*3 + 2] = d.bz + Math.sin(ph * 0.37) * d.amp;

            d.brightness *= DECAY;

            // pow(0.45) gives a sharp pop at peak then gradual fade — more dramatic
            tmp.lerpColors(C.nodeBase, C.nodeGlow, Math.pow(d.brightness, 0.45));
            nCol[i*3]     = tmp.r;
            nCol[i*3 + 1] = tmp.g;
            nCol[i*3 + 2] = tmp.b;
        }
        nodeGeo.attributes.position.needsUpdate = true;
        nodeGeo.attributes.color.needsUpdate    = true;

        for (let e = 0; e < edges.length; e++) {
            const [ai, bi] = edges[e];
            ePos[e*6]     = nPos[ai*3];     ePos[e*6+1] = nPos[ai*3+1]; ePos[e*6+2] = nPos[ai*3+2];
            ePos[e*6+3]   = nPos[bi*3];     ePos[e*6+4] = nPos[bi*3+1]; ePos[e*6+5] = nPos[bi*3+2];

            const bright = Math.max(nodeData[ai].brightness, nodeData[bi].brightness);
            tmp.lerpColors(C.edgeBase, C.edgeGlow, Math.pow(bright, 0.55));
            eCol[e*6]   = tmp.r; eCol[e*6+1] = tmp.g; eCol[e*6+2] = tmp.b;
            eCol[e*6+3] = tmp.r; eCol[e*6+4] = tmp.g; eCol[e*6+5] = tmp.b;
        }
        edgeGeo.attributes.position.needsUpdate = true;
        edgeGeo.attributes.color.needsUpdate    = true;

        renderer.render(scene, camera);
    }

    animate();
})();
