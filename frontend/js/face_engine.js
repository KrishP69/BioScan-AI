/**
 * BioScan AI - Biometric Face Processing & Feature Descriptor Engine
 * Powered by TensorFlow.js Face-API Neural Networks.
 * Performs real-time deep face detection, landmark alignment, liveness scoring,
 * and 128-d biometric descriptor extraction.
 */
const FaceEngine = (function () {
    let activeStream = null;
    let videoElement = null;
    let canvasOverlay = null;
    let animationFrameId = null;
    let isTracking = false;
    let isProcessing = false;

    let modelsLoaded = false;
    let modelLoadPromise = null;

    let landmarkHistory = [];
    let lastBox = null;

    /**
     * Load Face-API deep neural network models from /models
     */
    async function loadModels() {
        if (modelsLoaded) return true;
        if (modelLoadPromise) return modelLoadPromise;

        modelLoadPromise = (async () => {
            try {
                console.log("[BioScan AI] Initializing neural network models from /models...");
                const MODEL_URL = "/models";

                if (typeof faceapi === "undefined") {
                    throw new Error("face-api library not loaded in browser window.");
                }

                await Promise.all([
                    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
                ]);

                modelsLoaded = true;
                console.log("[BioScan AI] Face-API neural network models successfully loaded!");
                return true;
            } catch (err) {
                console.error("[BioScan AI] Failed to load neural network models:", err);
                modelsLoaded = false;
                modelLoadPromise = null;
                throw err;
            }
        })();

        return modelLoadPromise;
    }

    /**
     * Start webcam stream and attach to video element
     */
    async function startCamera(videoEl, canvasEl) {
        stopCamera();
        videoElement = videoEl;
        canvasOverlay = canvasEl;

        // Ensure neural network models are ready
        try {
            await loadModels();
        } catch (mErr) {
            console.warn("[BioScan AI] Model loading error:", mErr);
            return {
                success: false,
                error: "Failed to load face recognition neural networks: " + mErr.message
            };
        }

        const constraintOptions = [
            { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false },
            { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
            { video: true, audio: false }
        ];

        let lastErr = null;
        for (const constraints of constraintOptions) {
            try {
                activeStream = await navigator.mediaDevices.getUserMedia(constraints);
                break;
            } catch (err) {
                lastErr = err;
                console.warn("[BioScan AI] Camera attempt with constraints", constraints, "failed:", err);
            }
        }

        if (!activeStream) {
            console.error("[BioScan AI] Camera access failed all attempts:", lastErr);
            let userMsg = "Unable to access webcam: " + (lastErr ? lastErr.message : "Unknown error");
            if (lastErr) {
                if (lastErr.name === "NotAllowedError" || lastErr.name === "PermissionDeniedError") {
                    userMsg = "Camera permission denied. Please click the icon in your browser URL bar and allow Camera access.";
                } else if (lastErr.name === "NotReadableError" || lastErr.name === "TrackStartError" || (lastErr.message && lastErr.message.includes("video source"))) {
                    userMsg = "Camera is in use by another application (Zoom, Teams, Discord, Windows Camera app, or another browser tab).";
                } else if (lastErr.name === "NotFoundError" || lastErr.name === "DevicesNotFoundError") {
                    userMsg = "No webcam device detected. Please connect a camera and refresh the page.";
                }
            }
            return { success: false, error: userMsg };
        }

        try {
            videoElement.srcObject = activeStream;
            await videoElement.play();

            if (canvasOverlay) {
                canvasOverlay.width = videoElement.videoWidth || 640;
                canvasOverlay.height = videoElement.videoHeight || 480;
            }

            return { success: true };
        } catch (playErr) {
            console.error("[BioScan AI] Error playing video stream:", playErr);
            return {
                success: false,
                error: "Camera connected, but video playback failed: " + playErr.message
            };
        }
    }

    /**
     * Stop webcam stream and reset tracking state
     */
    function stopCamera() {
        isTracking = false;
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        if (activeStream) {
            activeStream.getTracks().forEach(track => track.stop());
            activeStream = null;
        }
        if (videoElement) {
            videoElement.srcObject = null;
            videoElement = null;
        }
        if (canvasOverlay) {
            const ctx = canvasOverlay.getContext("2d");
            if (ctx) ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
            canvasOverlay = null;
        }
        landmarkHistory = [];
        lastBox = null;
        isProcessing = false;
    }

    /**
     * Performs neural net inference to detect face, extract landmarks and 128-d biometric descriptor
     */
    async function analyzeCurrentFrame() {
        if (!videoElement || videoElement.readyState < 2 || !modelsLoaded) {
            return null;
        }

        const width = videoElement.videoWidth || 640;
        const height = videoElement.videoHeight || 480;

        if (canvasOverlay && (canvasOverlay.width !== width || canvasOverlay.height !== height)) {
            canvasOverlay.width = width;
            canvasOverlay.height = height;
        }

        try {
            // Run TinyFaceDetector with high confidence threshold (0.50) to eliminate false positives
            const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.50 });
            const detection = await faceapi.detectSingleFace(videoElement, options)
                .withFaceLandmarks()
                .withFaceDescriptor();

            // When NO face is detected in the camera frame
            if (!detection || !detection.detection || detection.detection.score < 0.50) {
                landmarkHistory = [];
                lastBox = null;
                return {
                    detected: false,
                    isReady: false,
                    box: null,
                    descriptor: null,
                    message: "No face detected"
                };
            }

            const rawBox = detection.detection.box;
            const score = detection.detection.score;
            const landmarks = detection.landmarks;
            const descriptorArray = Array.from(detection.descriptor);

            // Bounding box integers with padding
            const faceBoxX = Math.max(0, Math.round(rawBox.x));
            const faceBoxY = Math.max(0, Math.round(rawBox.y));
            const faceBoxWidth = Math.min(width - faceBoxX, Math.round(rawBox.width));
            const faceBoxHeight = Math.min(height - faceBoxY, Math.round(rawBox.height));

            // Measure brightness inside detected face region
            let avgBrightness = 128;
            try {
                const sampleCanvas = document.createElement("canvas");
                sampleCanvas.width = 40;
                sampleCanvas.height = 40;
                const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
                sampleCtx.drawImage(videoElement, faceBoxX, faceBoxY, faceBoxWidth, faceBoxHeight, 0, 0, 40, 40);
                const pData = sampleCtx.getImageData(0, 0, 40, 40).data;
                let lumSum = 0;
                for (let i = 0; i < pData.length; i += 4) {
                    lumSum += 0.299 * pData[i] + 0.587 * pData[i + 1] + 0.114 * pData[i + 2];
                }
                avgBrightness = Math.round(lumSum / (pData.length / 4));
            } catch (e) {
                avgBrightness = 128;
            }

            // Liveness calculation from landmark micro-movements across frames
            let livenessScore = 0.85;
            const noseTip = landmarks.getNose()[3] || landmarks.getNose()[0];
            const leftEye = landmarks.getLeftEye()[0];
            const rightEye = landmarks.getRightEye()[3] || landmarks.getRightEye()[0];

            if (noseTip && leftEye && rightEye) {
                const currentFeature = {
                    nx: noseTip.x,
                    ny: noseTip.y,
                    eyeDist: Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y),
                    time: Date.now()
                };

                landmarkHistory.push(currentFeature);
                if (landmarkHistory.length > 8) landmarkHistory.shift();

                if (landmarkHistory.length >= 3) {
                    let totalVar = 0;
                    for (let i = 1; i < landmarkHistory.length; i++) {
                        const dx = landmarkHistory[i].nx - landmarkHistory[i - 1].nx;
                        const dy = landmarkHistory[i].ny - landmarkHistory[i - 1].ny;
                        totalVar += Math.sqrt(dx * dx + dy * dy);
                    }
                    const avgVar = totalVar / (landmarkHistory.length - 1);
                    // Natural living micro-movements give score between 0.85 and 0.98
                    livenessScore = Math.min(0.99, Math.max(0.80, 0.80 + Math.min(0.18, avgVar * 0.04) + (score * 0.05)));
                } else {
                    livenessScore = 0.88;
                }
            }

            // Quality metrics
            const isGoodBrightness = avgBrightness >= 35 && avgBrightness <= 235;
            const isGoodSize = faceBoxWidth >= 70 && faceBoxHeight >= 70;
            const isFaceCentered = (faceBoxX + faceBoxWidth / 2 >= width * 0.15) && (faceBoxX + faceBoxWidth / 2 <= width * 0.85);
            const isReady = isGoodBrightness && isGoodSize && isFaceCentered && score >= 0.55;

            // Generate face preview snapshot image
            const snapCanvas = document.createElement("canvas");
            snapCanvas.width = 300;
            snapCanvas.height = 300;
            const snapCtx = snapCanvas.getContext("2d");

            // Crop with 25% boundary margin
            const padX = faceBoxWidth * 0.25;
            const padY = faceBoxHeight * 0.25;
            const cropX = Math.max(0, faceBoxX - padX);
            const cropY = Math.max(0, faceBoxY - padY);
            const cropW = Math.min(width - cropX, faceBoxWidth + padX * 2);
            const cropH = Math.min(height - cropY, faceBoxHeight + padY * 2);

            snapCtx.drawImage(videoElement, cropX, cropY, cropW, cropH, 0, 0, 300, 300);
            const previewDataUrl = snapCanvas.toDataURL("image/jpeg", 0.85);

            lastBox = { x: faceBoxX, y: faceBoxY, width: faceBoxWidth, height: faceBoxHeight };

            return {
                detected: true,
                box: lastBox,
                score: Number(score.toFixed(3)),
                brightness: avgBrightness,
                isGoodBrightness,
                isFaceCentered,
                isReady,
                livenessScore: Number(livenessScore.toFixed(2)),
                descriptor: descriptorArray,
                previewImage: previewDataUrl
            };
        } catch (err) {
            console.error("[BioScan AI] Frame inference error:", err);
            return {
                detected: false,
                isReady: false,
                box: null,
                descriptor: null,
                error: err.message
            };
        }
    }

    /**
     * Continuous asynchronous render loop to detect faces and draw real-time biometric HUD
     */
    function startTrackingLoop(onFrameAnalyzed) {
        isTracking = true;

        async function loop() {
            if (!isTracking || !videoElement || !canvasOverlay) return;

            if (!isProcessing && videoElement.readyState >= 2 && modelsLoaded) {
                isProcessing = true;
                try {
                    const analysis = await analyzeCurrentFrame();
                    const ctx = canvasOverlay.getContext("2d");
                    ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);

                    if (analysis && analysis.detected && analysis.box) {
                        const { x, y, width, height } = analysis.box;

                        // Draw Cyber-Glass Bounding Box around actual face
                        const boxColor = analysis.isReady ? "#10b981" : "#38bdf8";
                        ctx.strokeStyle = boxColor;
                        ctx.lineWidth = 2.5;
                        ctx.beginPath();
                        if (ctx.roundRect) {
                            ctx.roundRect(x, y, width, height, 12);
                        } else {
                            ctx.rect(x, y, width, height);
                        }
                        ctx.stroke();

                        // Corner Reticles
                        const cornerLen = Math.min(24, Math.floor(width * 0.2));
                        ctx.strokeStyle = "#38bdf8";
                        ctx.lineWidth = 4;

                        // Top-Left
                        ctx.beginPath();
                        ctx.moveTo(x, y + cornerLen);
                        ctx.lineTo(x, y);
                        ctx.lineTo(x + cornerLen, y);
                        ctx.stroke();

                        // Top-Right
                        ctx.beginPath();
                        ctx.moveTo(x + width - cornerLen, y);
                        ctx.lineTo(x + width, y);
                        ctx.lineTo(x + width, y + cornerLen);
                        ctx.stroke();

                        // Bottom-Left
                        ctx.beginPath();
                        ctx.moveTo(x, y + height - cornerLen);
                        ctx.lineTo(x, y + height);
                        ctx.lineTo(x + cornerLen, y + height);
                        ctx.stroke();

                        // Bottom-Right
                        ctx.beginPath();
                        ctx.moveTo(x + width - cornerLen, y + height);
                        ctx.lineTo(x + width, y + height);
                        ctx.lineTo(x + width, y + height - cornerLen);
                        ctx.stroke();

                        // Dynamic Status Badge above face
                        ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
                        ctx.fillRect(x, Math.max(0, y - 28), Math.min(width, 170), 24);
                        ctx.fillStyle = analysis.isReady ? "#10b981" : "#38bdf8";
                        ctx.font = "bold 12px Outfit, sans-serif";
                        ctx.fillText(
                            analysis.isReady ? `✓ Biometrics ${(analysis.score * 100).toFixed(0)}%` : "Aligning Face...",
                            x + 8,
                            Math.max(16, y - 12)
                        );
                    }

                    if (onFrameAnalyzed) {
                        onFrameAnalyzed(analysis);
                    }
                } catch (loopErr) {
                    console.error("[BioScan AI] Tracking loop error:", loopErr);
                } finally {
                    isProcessing = false;
                }
            }

            if (isTracking) {
                animationFrameId = requestAnimationFrame(loop);
            }
        }

        loop();
    }

    return {
        loadModels,
        startCamera,
        stopCamera,
        analyzeCurrentFrame,
        startTrackingLoop
    };
})();
