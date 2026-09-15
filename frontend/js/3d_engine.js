/**
 * BioScan AI - 3D Engine & Interactive Cybernetic Experience
 * Provides:
 * 1. WebGL Three.js Cybernetic Biometric Mesh Background (responsive to 3D mouse parallax)
 * 2. Real-Time 3D Card Tilt Physics with Dynamic Holographic Glare
 * 3. Interactive Volumetric Cursor Spotlight
 * 4. Holographic 3D Biometric Scanner HUD Visuals
 */

const ThreeD_Engine = (function () {
    let scene, camera, renderer, particles, geometry, material;
    let targetRotationX = 0, targetRotationY = 0;
    let currentRotationX = 0, currentRotationY = 0;
    let mouseX = 0, mouseY = 0;
    let windowHalfX = window.innerWidth / 2;
    let windowHalfY = window.innerHeight / 2;
    let isInitialized = false;
    let animationFrameId = null;

    // --------------------------------------------------------------------------
    // 1. THREE.JS 3D CYBERNETIC MESH BACKGROUND
    // --------------------------------------------------------------------------
    function initWebGLBackground() {
        const canvas = document.getElementById("webgl-3d-bg");
        if (!canvas || typeof THREE === "undefined") return;

        try {
            scene = new THREE.Scene();
            scene.fog = new THREE.FogExp2(0x05070e, 0.0012);

            camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 3000);
            camera.position.z = 1000;

            renderer = new THREE.WebGLRenderer({
                canvas: canvas,
                alpha: true,
                antialias: true,
                powerPreference: "high-performance"
            });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

            // Create Biometric Lattice & Neural Synapses
            const particleCount = 750;
            geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(particleCount * 3);
            const colors = new Float32Array(particleCount * 3);
            const scales = new Float32Array(particleCount);

            const colorPrimary = new THREE.Color(0x00f0ff);   // Electric Cyan
            const colorSecondary = new THREE.Color(0x6366f1); // Indigo
            const colorAccent = new THREE.Color(0x8b5cf6);    // Violet

            for (let i = 0; i < particleCount; i++) {
                // Sphere-like and cloud-like distribution for cybernetic aura
                const radius = 600 + Math.random() * 800;
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos((Math.random() * 2) - 1);

                positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
                positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
                positions[i * 3 + 2] = (radius * Math.cos(phi)) - 200;

                const mixFactor = Math.random();
                const mixedColor = mixFactor < 0.5 
                    ? colorPrimary.clone().lerp(colorSecondary, mixFactor * 2)
                    : colorSecondary.clone().lerp(colorAccent, (mixFactor - 0.5) * 2);

                colors[i * 3] = mixedColor.r;
                colors[i * 3 + 1] = mixedColor.g;
                colors[i * 3 + 2] = mixedColor.b;

                scales[i] = Math.random() * 2 + 1;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

            // Procedural glowing round sprite
            const spriteCanvas = document.createElement('canvas');
            spriteCanvas.width = 64;
            spriteCanvas.height = 64;
            const ctx = spriteCanvas.getContext('2d');
            const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
            gradient.addColorStop(0.25, 'rgba(56, 189, 248, 0.9)');
            gradient.addColorStop(0.5, 'rgba(99, 102, 241, 0.4)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 64, 64);

            const texture = new THREE.CanvasTexture(spriteCanvas);

            material = new THREE.PointsMaterial({
                size: 9,
                map: texture,
                vertexColors: true,
                transparent: true,
                opacity: 0.75,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            particles = new THREE.Points(geometry, material);
            scene.add(particles);

            // Add secondary wireframe 3D geometric ring for cyber biometric atmosphere
            const ringGeo = new THREE.TorusGeometry(520, 24, 16, 100);
            const ringMat = new THREE.MeshBasicMaterial({
                color: 0x38bdf8,
                wireframe: true,
                transparent: true,
                opacity: 0.15
            });
            const ringMesh = new THREE.Mesh(ringGeo, ringMat);
            ringMesh.rotation.x = Math.PI / 3;
            scene.add(ringMesh);

            // Outer floating dodecahedron constellation
            const polyGeo = new THREE.IcosahedronGeometry(750, 1);
            const polyMat = new THREE.MeshBasicMaterial({
                color: 0x6366f1,
                wireframe: true,
                transparent: true,
                opacity: 0.08
            });
            const polyMesh = new THREE.Mesh(polyGeo, polyMat);
            scene.add(polyMesh);

            window.addEventListener('resize', onWindowResize, false);

            function animate(time) {
                animationFrameId = requestAnimationFrame(animate);

                // Gentle subtle background parallax with soft dampening
                currentRotationX += (targetRotationX - currentRotationX) * 0.03;
                currentRotationY += (targetRotationY - currentRotationY) * 0.03;

                camera.position.x = currentRotationX * 60;
                camera.position.y = -currentRotationY * 45;
                camera.lookAt(scene.position);

                // Slow subtle self-rotation
                particles.rotation.y += 0.0004;
                particles.rotation.x += 0.0002;
                ringMesh.rotation.z += 0.0008;
                ringMesh.rotation.y += 0.0004;
                polyMesh.rotation.y -= 0.0003;

                renderer.render(scene, camera);
            }

            animate(0);
        } catch (err) {
            console.warn("Three.js initialization skipped/fallback active:", err);
        }
    }

    function onWindowResize() {
        if (!camera || !renderer) return;
        windowHalfX = window.innerWidth / 2;
        windowHalfY = window.innerHeight / 2;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // --------------------------------------------------------------------------
    // 2. 3D CARD & SLIDE TILT (ULTRA-LOW, SUBTLE MICRO-DEPTH, ZERO WOBBLE)
    // --------------------------------------------------------------------------
    function applyCardTilt(card) {
        if (card.dataset.tiltInitialized) return;
        card.dataset.tiltInitialized = "true";

        // Create subtle holographic glare element
        let glare = card.querySelector(".tilt-glare");
        if (!glare) {
            glare = document.createElement("div");
            glare.className = "tilt-glare";
            card.appendChild(glare);
        }

        let bounds = null;
        const isLargePanel = card.classList.contains("glass-panel");
        // Ultra-low max tilt angle to eliminate any wobble effect:
        // Large slides/panels (like audit logs or login) are kept to ~0.75deg, smaller cards to ~1.4deg
        const maxTilt = isLargePanel ? 0.75 : 1.4;
        const perspectiveDist = isLargePanel ? 2600 : 2000;
        const scaleVal = isLargePanel ? 1.001 : 1.005;

        function onMouseEnter(e) {
            bounds = card.getBoundingClientRect();
            card.style.transition = "transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.28s ease-out";
            glare.style.opacity = isLargePanel ? "0.35" : "0.55";
        }

        function onMouseMove(e) {
            if (!bounds) bounds = card.getBoundingClientRect();
            if (bounds.width === 0 || bounds.height === 0) return;

            const mouseX = e.clientX - bounds.left;
            const mouseY = e.clientY - bounds.top;

            const xPct = Math.max(0, Math.min(1, mouseX / bounds.width));
            const yPct = Math.max(0, Math.min(1, mouseY / bounds.height));

            // Compute very slight, low tilt angles
            const tiltX = ((0.5 - yPct) * (maxTilt * 2)).toFixed(2);
            const tiltY = ((xPct - 0.5) * (maxTilt * 2)).toFixed(2);

            card.style.transform = `perspective(${perspectiveDist}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale3d(${scaleVal}, ${scaleVal}, ${scaleVal})`;

            // Silky subtle specular shine
            glare.style.background = `radial-gradient(circle at ${xPct * 100}% ${yPct * 100}%, rgba(255, 255, 255, 0.10) 0%, rgba(56, 189, 248, 0.04) 40%, transparent 70%)`;
        }

        function onMouseLeave() {
            card.style.transition = "transform 0.5s cubic-bezier(0.25, 1, 0.5, 1), box-shadow 0.5s ease";
            card.style.transform = `perspective(${perspectiveDist}px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
            glare.style.opacity = "0";
            bounds = null;
        }

        card.addEventListener("mouseenter", onMouseEnter, { passive: true });
        card.addEventListener("mousemove", onMouseMove, { passive: true });
        card.addEventListener("mouseleave", onMouseLeave, { passive: true });
    }

    function initCards() {
        // Target cards and panels (slides, login box, audit logs, feature cards)
        const tiltTargets = document.querySelectorAll(".glass-card, .glass-panel, .stat-card, .period-card, .cyber-portal-card");
        tiltTargets.forEach(card => applyCardTilt(card));
    }

    // --------------------------------------------------------------------------
    // 3. DYNAMIC VOLUMETRIC CURSOR SPOTLIGHT
    // --------------------------------------------------------------------------
    function initCursorLighting() {
        const glowEl = document.getElementById("cursor-glow");

        window.addEventListener("pointermove", (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;

            // Parallax target for 3D camera
            targetRotationX = (mouseX - windowHalfX) / windowHalfX;
            targetRotationY = (mouseY - windowHalfY) / windowHalfY;

            // Update CSS custom variables for global 3D dynamic shine
            document.documentElement.style.setProperty("--cursor-x", `${mouseX}px`);
            document.documentElement.style.setProperty("--cursor-y", `${mouseY}px`);

            if (glowEl) {
                glowEl.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0)`;
                if (glowEl.style.opacity !== "1") glowEl.style.opacity = "1";
            }
        });

        document.addEventListener("mouseleave", () => {
            targetRotationX = 0;
            targetRotationY = 0;
            if (glowEl) glowEl.style.opacity = "0";
        });
    }

    // --------------------------------------------------------------------------
    // INITIALIZATION & OBSERVER
    // --------------------------------------------------------------------------
    function init() {
        if (isInitialized) return;
        isInitialized = true;

        initWebGLBackground();
        initCursorLighting();
        initCards();

        // Observe DOM mutations to automatically attach 3D tilt to dynamic SPA views
        const viewport = document.getElementById("app-viewport");
        if (viewport) {
            const observer = new MutationObserver(() => {
                setTimeout(initCards, 50);
            });
            observer.observe(viewport, { childList: true, subtree: true });
        }
    }

    return {
        init,
        initCards
    };
})();

// Auto-boot on DOM ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ThreeD_Engine.init);
} else {
    ThreeD_Engine.init();
}
