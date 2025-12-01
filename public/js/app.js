/* Plan (pseudocode):
   - Keep two independent clocks:
     - wallElapsed: derived from accumulatedMs + running interval (unchanged).
     - tick-based clock: advances only from its own accumulator (tickAccumMs) using appliedFps.
   - Ensure we NEVER resync tickCount to the wall clock except on explicit reset.
   - On Apply FPS: change appliedFps but do NOT recompute tickCount from wall time; reset tickAccumMs so the new rate takes effect cleanly.
   - On Skip: seek the video and update the wall timer state (accumulatedMs) but do NOT touch tickCount or its accumulators.
   - When paused (running === false): stop advancing tickAccumMs but do NOT set tickCount from wall clock.
   - Reset still resets both clocks to zero (intended behavior).
   - Keep UI updates minimal: wall timer, tick counter, applied FPS, calculated tick-based time (only update when tickCount changes).
*/

(function () {
    'use strict';

    // Default YouTube video id (change as needed)
    const VIDEO_ID = 'dQw4w9WgXcQ';
    const DEFAULT_FPS = 60;

    let player = null;

    // Timer state (milliseconds)
    let accumulatedMs = 0;
    let lastStartMs = 0;
    let running = false;
    let rafId = 0;

    // appliedFps is the value actually used in math (changed only when Apply is clicked)
    let appliedFps = DEFAULT_FPS;

    // lastShownTick ensures the calculated clock only updates when the integer tick changes
    let lastShownTick = -1;

    // Independent tick/tick-accumulator state so tick/FPS clock can run separately
    let tickCount = 0;
    let tickAccumMs = 0;
    let lastTickUpdateMs = 0;

    const timerEl = () => document.getElementById('timer');
    const fpsInputEl = () => document.getElementById('fpsInput');
    const tickCounterEl = () => document.getElementById('tickCounter');
    const appliedFpsDisplayEl = () => document.getElementById('appliedFpsDisplay');
    const calculatedTimeEl = () => document.getElementById('calculatedTime');

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    // Format milliseconds -> MM:ss:ff (hundredths)
    function formatMs(ms) {
        const totalHundredths = Math.floor(ms / 10);
        const minutes = Math.floor(totalHundredths / 6000);
        const seconds = Math.floor((totalHundredths % 6000) / 100);
        const hundredths = totalHundredths % 100;
        return `${pad(minutes)}:${pad(seconds)}:${pad(hundredths)}`;
    }

    // Convert elapsed ms and current fps to tick count (integer)
    function computeTicks(ms, fpsValue) {
        const seconds = ms / 1000;
        return Math.floor(seconds * Math.max(0, Number(fpsValue) || DEFAULT_FPS));
    }

    function updateUi() {
        const now = performance.now();
        const elapsed = accumulatedMs + (running ? (now - lastStartMs) : 0);

        // Continuous wall-clock display
        const tEl = timerEl();
        if (tEl) tEl.textContent = formatMs(elapsed);

        // Advance tick state independently while running
        if (running) {
            if (!lastTickUpdateMs) lastTickUpdateMs = now;
            const delta = now - lastTickUpdateMs;
            lastTickUpdateMs = now;
            tickAccumMs += delta;

            const msPerTick = 1000 / Math.max(1, appliedFps);
            if (tickAccumMs >= msPerTick) {
                const newTicks = Math.floor(tickAccumMs / msPerTick);
                tickCount += newTicks;
                tickAccumMs -= newTicks * msPerTick;
            }
        } else {
            // When paused/stopped: do NOT resync tickCount to the wall clock.
            // Just stop advancing tickAccumMs and clear lastTickUpdateMs so
            // timing restarts fresh on resume.
            lastTickUpdateMs = 0;
        }

        // Update tick counter element
        const tickEl = tickCounterEl();
        if (tickEl) tickEl.textContent = `Ticks: ${tickCount}`;

        // Applied FPS display
        const afEl = appliedFpsDisplayEl();
        if (afEl) afEl.textContent = `Applied FPS: ${appliedFps}`;

        // Calculated (quantized) clock derived from tickCount (independent)
        const calcEl = calculatedTimeEl();
        if (calcEl) {
            if (tickCount !== lastShownTick) {
                lastShownTick = tickCount;
                // Use a fixed baseline FPS for time conversion so raising appliedFps
                // increases tick accumulation rate relative to wall clock.
                const calcMs = Math.round((tickCount / DEFAULT_FPS) * 1000);
                calcEl.textContent = `Calculated: ${formatMs(calcMs)}`;
            }
        }
    }

    function tick() {
        updateUi();
        if (running) {
            rafId = requestAnimationFrame(tick);
        }
    }

    // YouTube API ready callback (global name required by API)
    window.onYouTubeIframeAPIReady = function () {
        if (player) return;
        player = new YT.Player('player', {
            height: '360',
            width: '640',
            videoId: VIDEO_ID,
            playerVars: { controls: 1, rel: 0 },
            events: {
                onReady: function () { /* no-op */ },
                onStateChange: function () { /* optional */ }
            }
        });
    };

    function play() {
        if (!running) {
            lastStartMs = performance.now();
            // start tick update timing separate from lastStartMs
            lastTickUpdateMs = performance.now();
            running = true;
            if (!rafId) rafId = requestAnimationFrame(tick);
        }
        if (player && player.playVideo) player.playVideo();
        updateUi();
    }

    function stop() {
        if (running) {
            accumulatedMs += performance.now() - lastStartMs;
            running = false;
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = 0;
            }
        }
        if (player && player.pauseVideo) player.pauseVideo();
        updateUi();
    }

    // Reset: seek video to start, reset timer/ticks and start running
    function reset() {
        // Reset timer state to zero and start immediately
        accumulatedMs = 0;
        lastStartMs = performance.now();
        running = true;

        // reset tick state (reset both clocks)
        tickCount = 0;
        tickAccumMs = 0;
        lastTickUpdateMs = performance.now();

        // ensure calculated clock updates immediately
        lastShownTick = -1;

        // Ensure RAF loop is running
        if (!rafId) rafId = requestAnimationFrame(tick);

        // Seek video to start and play (if player available)
        if (player) {
            if (typeof player.seekTo === 'function') {
                try {
                    player.seekTo(0, true);
                } catch (e) {
                    // ignore seek errors
                }
            }
            if (player.playVideo) player.playVideo();
        }

        updateUi();
    }

    // Helper: clamp number between min and max
    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    // Seek logic used by skip controls
    // amount: positive number from UI, unit: 'ticks'|'seconds', direction: -1 or +1
    function skipBy(amount, unit, direction) {
        const numeric = Number(amount);
        if (!Number.isFinite(numeric) || numeric < 0 || (direction !== -1 && direction !== 1)) {
            return;
        }

        // Decide how many seconds the skip should represent
        const requestedSec = (unit === 'ticks') ? (numeric / Math.max(1, DEFAULT_FPS)) : numeric;
        const deltaSec = direction * requestedSec;

        // wall-derived current time (fallback)
        const wallCurrentSec = (accumulatedMs + (running ? (performance.now() - lastStartMs) : 0)) / 1000;

        // Prefer player current time as the baseline for seeking (so we SEEK RELATIVE to the player)
        // If player not available, fall back to wall timer
        let playerCurrentSec = wallCurrentSec;
        if (player && typeof player.getCurrentTime === 'function') {
            try {
                const p = Number(player.getCurrentTime());
                if (Number.isFinite(p)) playerCurrentSec = p;
            } catch (e) {
                playerCurrentSec = wallCurrentSec;
            }
        }

        // try to get duration for clamping
        let durationSec = Infinity;
        if (player && typeof player.getDuration === 'function') {
            try {
                const d = Number(player.getDuration());
                if (Number.isFinite(d) && d > 0) durationSec = d;
            } catch (e) {
                // ignore
            }
        }

        // compute the target player time by adding the delta (relative seek)
        const targetPlayerSec = clamp(playerCurrentSec + deltaSec, 0, durationSec);
        // actual jumped seconds might be different (if clamped)
        const actualJumpedSec = targetPlayerSec - playerCurrentSec;

        // Update tickCount according to the actual jumped seconds.
        // - For 'ticks' unit we interpret the user's numeric as tick count but we should
        //   adjust by the actual jumped seconds (in case of clamping) using DEFAULT_FPS so
        //   both calculated display and wall timer remain consistent.
        if (unit === 'ticks') {
            const actualTicks = Math.round(actualJumpedSec * DEFAULT_FPS);
            if (actualTicks !== 0) {
                tickCount = Math.max(0, tickCount + actualTicks);
                lastShownTick = -1;
            }
        } else { // seconds unit
            const deltaTicks = Math.round(actualJumpedSec * appliedFps);
            if (deltaTicks !== 0) {
                tickCount = Math.max(0, tickCount + deltaTicks);
                lastShownTick = -1;
            }
        }

        // Update accumulatedMs by the actual jumped amount (relative update, not absolute set)
        const now = performance.now();
        const durationMs = isFinite(durationSec) ? durationSec * 1000 : Infinity;
        const jumpMs = actualJumpedSec * 1000;

        if (running) {
            // Clamp so elapsed (accumulated + (now - lastStartMs)) doesn't exceed duration
            const maxAccum = Math.max(0, durationMs - (now - lastStartMs));
            accumulatedMs = clamp(accumulatedMs + jumpMs, 0, maxAccum);
            lastTickUpdateMs = performance.now();
        } else {
            accumulatedMs = clamp(accumulatedMs + jumpMs, 0, durationMs);
            lastTickUpdateMs = 0;
        }

        // ensure wall-clock updates immediately
        updateUi();

        // perform the actual seek on the player relative to its own current position
        if (player && typeof player.seekTo === 'function') {
            try {
                player.seekTo(targetPlayerSec, true);
            } catch (e) {
                // ignore seek errors
            }
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        const playBtn = document.getElementById('playBtn');
        const stopBtn = document.getElementById('stopBtn');
        const resetBtn = document.getElementById('resetBtn');
        const fpsInput = fpsInputEl();
        const tickEl = tickCounterEl();
        const applyFpsBtn = document.getElementById('applyFpsBtn');
        const appliedFpsEl = appliedFpsDisplayEl();

        // Skip controls
        const skipAmountEl = document.getElementById('skipAmount');
        const skipUnitEl = document.getElementById('skipUnit');
        const skipBackBtn = document.getElementById('skipBackBtn');
        const skipForwardBtn = document.getElementById('skipForwardBtn');

        playBtn.addEventListener('click', play);
        stopBtn.addEventListener('click', stop);
        if (resetBtn) resetBtn.addEventListener('click', reset);

        // commitAppliedFps: centralize parsing/validation and UI update for Apply
        function commitAppliedFps() {
            if (!fpsInput) return false;
            const raw = fpsInput.value;
            const v = Number(raw);
            const valid = Number.isFinite(v) && v > 0;
            if (!valid) return false;

            // Do NOT resync tickCount from wall clock; make the tick clock use the new rate going forward.
            appliedFps = v;
            // Reset accumulator so the new FPS takes effect cleanly
            tickAccumMs = 0;
            lastTickUpdateMs = running ? performance.now() : 0;

            lastShownTick = -1; // force recalculation of calculated clock on next tick change
            if (appliedFpsEl) appliedFpsEl.textContent = `Applied FPS: ${appliedFps}`;
            updateUi();
            return true;
        }

        // Initialize applied FPS from input
        if (fpsInput) {
            // set initial appliedFps from the input's starting value
            appliedFps = Number(fpsInput.value) || DEFAULT_FPS;
            if (appliedFpsEl) appliedFpsEl.textContent = `Applied FPS: ${appliedFps}`;

            // Validate input on change and enable/disable Apply button
            fpsInput.addEventListener('input', function (e) {
                const v = Number(e.target.value);
                const valid = Number.isFinite(v) && v > 0;
                if (applyFpsBtn) applyFpsBtn.disabled = !valid;
            });

            // support Enter key to apply the value
            fpsInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    // prevent form submission if ever inside a form
                    e.preventDefault();
                    if (commitAppliedFps() && applyFpsBtn) {
                        // optional: provide brief feedback by focusing button
                        applyFpsBtn.focus();
                    }
                }
            });
        }

        // Apply button commits the FPS into the math
        if (applyFpsBtn) {
            applyFpsBtn.addEventListener('click', function () {
                commitAppliedFps();
            });
            // initial enable state
            if (fpsInput) {
                const v = Number(fpsInput.value);
                applyFpsBtn.disabled = !(Number.isFinite(v) && v > 0);
            }
        }

        // Wire skip buttons
        if (skipBackBtn && skipForwardBtn && skipAmountEl && skipUnitEl) {
            skipBackBtn.addEventListener('click', function () {
                skipBy(skipAmountEl.value, skipUnitEl.value, -1);
            });
            skipForwardBtn.addEventListener('click', function () {
                skipBy(skipAmountEl.value, skipUnitEl.value, 1);
            });
        }

        // Ensure tick counter exists
        if (tickEl && tickEl.textContent.trim() === '') {
            tickEl.textContent = 'Ticks: 0';
        }

        // If YouTube API already loaded before DOMContentLoaded
        if (typeof YT !== 'undefined' && YT && YT.Player && !player) {
            window.onYouTubeIframeAPIReady();
        }

        // Initial tick state: keep independent (start at 0)
        tickCount = 0;
        tickAccumMs = 0;
        lastTickUpdateMs = 0;

        // Initial render
        updateUi();
    });

    // expose functions for debugging if needed
    window.ytTimer = { play, stop, reset, formatMs, computeTicks, skipBy };
})();