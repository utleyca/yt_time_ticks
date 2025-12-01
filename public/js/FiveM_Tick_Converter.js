// JavaScript source code
// To sync up tick rate in FiveM, you need to understand that FiveM servers run at a fixed tick rate (commonly 20 TPS).
// This converter maps ticks/time between a source tick rate (e.g. YouTube 60 FPS) and the configured FiveM tick rate.
// The initial tick rate will be taken from the DOM input `#fivemTickRateInput` when available, falling back to 20.

(function (global) {
    'use strict';

    const DEFAULT_TICK_RATE = 20;

    // Try to read the initial tick rate from the DOM input element if available.
    // If not available (e.g. non-browser environment), fall back to DEFAULT_TICK_RATE.
    function detectInitialTickRate() {
        if (typeof document !== 'undefined' && document.getElementById) {
            try {
                const el = document.getElementById('fivemTickRateInput');
                if (el) {
                    const v = Number(el.value);
                    if (Number.isFinite(v) && v > 0) {
                        return v;
                    }
                }
            } catch (e) {
                // ignore and fall back
            }
        }
        return DEFAULT_TICK_RATE;
    }

    const initialTickRate = detectInitialTickRate();

    /**
     * TickConverter
     * Tracks time and tick values for a configured tick rate (default FiveM: 20 TPS).
     * Allows adding/subtracting ticks which will update the associated time value.
     *
     * Exposed as `window.TickConverter`.
     *
     * Note: `timeMs` is implemented as a dynamic property derived from the current
     * `ticks` and `tickDurationMs`, so it always reflects the active `tickRate`.
     */
    const TickConverter = {
        // Current tick rate (ticks per second). Initialized from DOM if present, otherwise DEFAULT_TICK_RATE.
        tickRate: initialTickRate,

        // Duration of a single tick in milliseconds (derived from tickRate).
        tickDurationMs: 1000 / initialTickRate,

        // Tracked tick count (integer). Use this as the single source of truth.
        ticks: 0,

        // Optional start reference time in ms (Date.now() style). Not required for conversions.
        startTimeMs: null,

        /**
         * Initialize or reset the tracker.
         * options:
         *  - tickRate: number (ticks per second)
         *  - startTicks: number
         *  - startTimeMs: number (epoch ms)
         */
        init: function (options) {
            options = options || {};
            this.tickRate = typeof options.tickRate === 'number' ? options.tickRate : initialTickRate;
            this.tickDurationMs = 1000 / this.tickRate;
            this.ticks = Number.isFinite(options.startTicks) ? Math.floor(options.startTicks) : 0;
            if (Number.isFinite(options.startTimeMs)) {
                // If explicit startTimeMs provided, compute corresponding ticks.
                this.ticks = Math.floor(options.startTimeMs / this.tickDurationMs);
            }
            this.startTimeMs = options.startTimeMs || null;
        },

        /**
         * Set the active tick rate.
         * newRate: number (ticks per second)
         * options:
         *  - preserveTime: boolean (default true) -- keep the same absolute timeMs and recompute ticks for new rate
         *  - preserveTicks: boolean (default false) -- keep same tick index and recompute timeMs (mutually exclusive with preserveTime)
         *
         * Returns the new state.
         */
        setTickRate: function (newRate, options) {
            options = options || {};
            if (!Number.isFinite(newRate) || newRate <= 0) {
                throw new TypeError('newRate must be a finite positive number');
            }

            var preserveTime = options.preserveTime !== false; // default true
            var preserveTicks = !!options.preserveTicks;

            // If caller requested preserveTicks, flip preserveTime off.
            if (preserveTicks) preserveTime = false;

            // capture current absolute time before changing rate
            var oldTime = this.timeMs;

            this.tickRate = newRate;
            this.tickDurationMs = 1000 / this.tickRate;

            if (preserveTime) {
                // keep the same absolute time in ms; recompute ticks for the new tick duration
                this.ticks = Math.floor(oldTime / this.tickDurationMs);
            } else {
                // preserve ticks (or default behavior when preserveTime=false): keep ticks and let timeMs reflect new rate
                this.ticks = Math.floor(this.ticks);
                if (this.ticks < 0) this.ticks = 0;
            }

            // update any bound DOM displays if present
            this._updateDomDisplays();

            return this.getState();
        },

        /**
         * Update internal state from a given time in milliseconds.
         * Computes integer `ticks` = floor(timeMs / tickDurationMs).
         */
        updateFromTimeMs: function (timeMs) {
            if (!Number.isFinite(timeMs)) {
                throw new TypeError('timeMs must be a finite number');
            }
            // Derive ticks from provided time and current tickDurationMs so time always
            // remains consistent with the active tickRate.
            this.ticks = Math.floor(Math.floor(timeMs) / this.tickDurationMs);
            this._updateDomDisplays();
        },

        /**
         * Update internal state from a given ticks value.
         * Sets `ticks` and leaves `timeMs` computed on demand.
         */
        updateFromTicks: function (ticks) {
            if (!Number.isFinite(ticks)) {
                throw new TypeError('ticks must be a finite number');
            }
            this.ticks = Math.floor(ticks);
            if (this.ticks < 0) this.ticks = 0;
            this._updateDomDisplays();
        },

        /**
         * Add (or subtract if delta is negative) ticks and update time accordingly.
         * Returns the new state object { ticks, timeMs }.
         */
        addTicks: function (deltaTicks) {
            if (!Number.isFinite(deltaTicks)) {
                throw new TypeError('deltaTicks must be a finite number');
            }
            this.ticks = this.ticks + Math.floor(deltaTicks);
            if (this.ticks < 0) this.ticks = 0;
            this._updateDomDisplays();
            return this.getState();
        },

        /**
         * Add (or subtract) milliseconds and update ticks accordingly.
         * Returns the new state object { ticks, timeMs }.
         */
        addTimeMs: function (deltaMs) {
            if (!Number.isFinite(deltaMs)) {
                throw new TypeError('deltaMs must be a finite number');
            }
            // Compute resulting time in ms, then derive ticks from it.
            var newTime = this.timeMs + Math.floor(deltaMs);
            this.updateFromTimeMs(newTime);
            return this.getState();
        },

        /**
         * Convert ticks from a different tick rate (e.g., YouTube 60 TPS) into this converter's tick space.
         * Example: convertTickRateTicks(ytTicks, 60) -> equivalent ticks for this.tickRate
         */
        convertTickRateTicks: function (sourceTicks, sourceTickRate) {
            if (!Number.isFinite(sourceTicks) || !Number.isFinite(sourceTickRate)) {
                throw new TypeError('sourceTicks and sourceTickRate must be finite numbers');
            }
            // Convert source ticks to milliseconds, then to this tick count.
            var sourceTickDurationMs = 1000 / sourceTickRate;
            var timeMs = sourceTicks * sourceTickDurationMs;
            return Math.floor(timeMs / this.tickDurationMs);
        },

        /**
         * Get a snapshot of current state.
         */
        getState: function () {
            return {
                tickRate: this.tickRate,
                tickDurationMs: this.tickDurationMs,
                ticks: this.ticks,
                timeMs: this.timeMs,
                startTimeMs: this.startTimeMs
            };
        },

        /**
         * Bind to DOM elements (if present) so user can change tick rate via the input/button in index.html.
         * This function is safe to call multiple times.
         */
        bindToDom: function () {
            if (typeof document === 'undefined' || !document.getElementById) {
                return;
            }

            var input = document.getElementById('fivemTickRateInput');
            var applyBtn = document.getElementById('applyFivemBtn');

            // Helper for validating and applying value
            var applyValue = function (raw) {
                var v = Number(raw);
                if (!Number.isFinite(v) || v <= 0) {
                    // invalid value: ignore
                    return;
                }
                // By default preserve the absolute time when switching tick rates so the same wall-clock time maps into new ticks.
                TickConverter.setTickRate(v, { preserveTime: true });
            };

            // update input display if present
            var displayRateEl = document.getElementById('fivemTickRate');
            var currentTickEl = document.getElementById('fivemCurrentTick');
            var fivemTimeEl = document.getElementById('fivemTime');

            // Live-update label when typing (does not commit)
            if (input) {
                input.addEventListener('input', function (e) {
                    if (displayRateEl) {
                        displayRateEl.textContent = 'Tick Rate: ' + (e.target.value || '');
                    }
                });
            }

            if (applyBtn && input) {
                applyBtn.addEventListener('click', function () {
                    applyValue(input.value);
                });
            }

            // Keep DOM displays in sync when the converter updates
            this._updateDomDisplays = function () {
                if (displayRateEl) {
                    displayRateEl.textContent = 'Tick Rate: ' + this.tickRate;
                }
                if (currentTickEl) {
                    currentTickEl.textContent = 'Current Tick: ' + this.ticks;
                }
                if (fivemTimeEl) {
                    fivemTimeEl.textContent = 'Time: ' + formatMsAsClock(this.timeMs);
                }
            }.bind(this);

            // initialize displays
            this._updateDomDisplays();
        },

        // Internal placeholder; will be replaced by bindToDom when DOM exists.
        _updateDomDisplays: function () { /* no-op until bound */ }
    };

    // Make `timeMs` a dynamic accessor so it always reflects the active tickRate.
    Object.defineProperty(TickConverter, 'timeMs', {
        enumerable: true,
        configurable: true,
        get: function () {
            // derive from ticks and current tickDurationMs
            return Math.floor(this.ticks * this.tickDurationMs);
        },
        set: function (value) {
            if (!Number.isFinite(value)) {
                throw new TypeError('timeMs must be a finite number');
            }
            // Setting timeMs should update ticks to match current tickDurationMs
            this.ticks = Math.floor(Math.floor(value) / this.tickDurationMs);
            if (this.ticks < 0) this.ticks = 0;
            this._updateDomDisplays();
        }
    });

    // Helper to format ms -> HH:MM:SS
    function formatMsAsClock(ms) {
        if (!Number.isFinite(ms) || ms < 0) ms = 0;
        var totalSeconds = Math.floor(ms / 1000);
        var hours = Math.floor(totalSeconds / 3600);
        var minutes = Math.floor((totalSeconds % 3600) / 60);
        var seconds = totalSeconds % 60;

        var hh = hours.toString().padStart(2, '0');
        var mm = minutes.toString().padStart(2, '0');
        var ss = seconds.toString().padStart(2, '0');

        return hh + ':' + mm + ':' + ss;
    }

    // Initialize with detected tick rate (from DOM when possible)
    TickConverter.init({ tickRate: initialTickRate, startTicks: 0 });

    // Auto-bind to DOM if available so changing `#fivemTickRateInput` affects converter immediately.
    if (typeof document !== 'undefined' && document.getElementById) {
        // Defer binding to allow index.html elements to exist (script is loaded before app.js but after HTML).
        // Using setTimeout 0 is safe here to run after current parsing/execution stack.
        setTimeout(function () {
            try {
                TickConverter.bindToDom();
            } catch (e) {
                // ignore binding failures
            }
        }, 0);
    }

    // Expose
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = TickConverter;
    } else {
        global.TickConverter = TickConverter;
    }
})(typeof window !== 'undefined' ? window : global);


