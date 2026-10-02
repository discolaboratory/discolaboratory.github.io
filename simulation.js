(() => {
    "use strict";

    const canvas = document.getElementById("ca-canvas");
    const hero = document.querySelector(".hero");
    const context = canvas?.getContext("2d");
    if (!canvas || !hero || !context) return;

    const birthInputs = Array.from(document.querySelectorAll('[data-rule="birth"] input'));
    const survivalInputs = Array.from(document.querySelectorAll('[data-rule="survive"] input'));
    const pauseButton = document.getElementById("ca-pause");
    const reseedButton = document.getElementById("ca-reset");
    const clearButton = document.getElementById("ca-clear");
    const stepButton = document.getElementById("ca-step");
    const presetButton = document.getElementById("ca-preset");
    const drawButton = document.getElementById("ca-draw");
    const status = document.getElementById("ca-status");
    const controls = document.querySelector(".ca-controls");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const themeToggle = document.querySelector("[data-theme-toggle]");
    const themeIcon = document.querySelector("[data-theme-icon]");
    const themeLabel = document.querySelector("[data-theme-label]");
    const themeStorageKey = "theme-preference";
    const phrase = "DiscoLab";
    const fontFamily = '"Space Grotesk", sans-serif';
    const stepMs = 160;

    // The logical board is initialized once. Resize changes its display scale only.
    const initialRect = hero.getBoundingClientRect();
    const initialCellSize = initialRect.width < 480 ? 8 : 6;
    const columns = Math.max(1, Math.floor(initialRect.width / initialCellSize));
    const rows = Math.max(1, Math.floor(initialRect.height / initialCellSize));
    let grid = makeGrid(columns, rows);
    let nextGrid = makeGrid(columns, rows);
    let renderWidth = 0;
    let renderHeight = 0;
    let cellWidth = 0;
    let cellHeight = 0;
    let liveCells = 0;
    let generation = 0;
    let birthRules = new Set([3]);
    let survivalRules = new Set([2, 3]);
    let liveColor = "rgba(102, 252, 241, 0.35)";
    let cursorColor = "#66FCF1";
    let cursor = { x: Math.floor(columns / 2), y: Math.floor(rows / 2) };
    let ready = false;
    let initialSeedPending = true;
    let manualPaused = true;
    let motionOptIn = false;
    let heroVisible = initialRect.bottom > 0 && initialRect.top < window.innerHeight;
    let running = false;
    let tickTimer = null;
    let autoStartTimer = null;
    let interactionOccurred = false;
    let drawMode = false;
    let drawingPointer = null;
    let previousDrawCell = null;
    let selectedTheme = readStoredTheme();
    let activeTheme = selectedTheme || systemTheme();

    function makeGrid(width, height) {
        return Array.from({ length: height }, () => new Uint8Array(width));
    }

    function readStoredTheme() {
        try {
            const stored = window.localStorage.getItem(themeStorageKey);
            return stored === "dark" || stored === "light" ? stored : null;
        } catch {
            return null;
        }
    }

    function systemTheme() {
        return darkQuery.matches ? "dark" : "light";
    }

    function applyTheme(theme) {
        activeTheme = theme;
        document.documentElement.setAttribute("data-theme", theme);
        themeToggle?.setAttribute("aria-pressed", String(theme === "dark"));
        themeToggle?.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
        if (themeIcon) themeIcon.textContent = theme === "dark" ? "☾" : "☀";
        if (themeLabel) themeLabel.textContent = `Theme: ${theme === "dark" ? "Dark" : "Light"}`;
        const styles = getComputedStyle(document.documentElement);
        liveColor = styles.getPropertyValue("--live-color").trim() || liveColor;
        cursorColor = styles.getPropertyValue("--accent-secondary").trim() || cursorColor;
        draw();
    }

    function toggleTheme() {
        // In-memory preference remains authoritative even if storage is unavailable.
        selectedTheme = activeTheme === "dark" ? "light" : "dark";
        try {
            window.localStorage.setItem(themeStorageKey, selectedTheme);
        } catch {
            // Persistence is optional; the current page still switches both ways.
        }
        applyTheme(selectedTheme);
    }

    function listenForPreference(query, handler) {
        if (query.addEventListener) query.addEventListener("change", handler);
        else if (query.addListener) query.addListener(handler);
    }

    function cancelAutoStart() {
        interactionOccurred = true;
        if (autoStartTimer !== null) window.clearTimeout(autoStartTimer);
        autoStartTimer = null;
    }

    function updateRunning() {
        running = ready && !manualPaused && (!motionQuery.matches || motionOptIn)
            && !document.hidden && heroVisible;
        if (pauseButton) {
            const action = running ? "Pause" : "Play";
            pauseButton.textContent = action;
            pauseButton.setAttribute("aria-label", action);
            pauseButton.setAttribute("title", action);
            pauseButton.dataset.running = String(running);
        }
        if (!running && tickTimer !== null) {
            window.clearTimeout(tickTimer);
            tickTimer = null;
        } else if (running && tickTimer === null) {
            tickTimer = window.setTimeout(tick, stepMs);
        }
    }

    function tick() {
        tickTimer = null;
        if (!running) return;
        step();
        draw();
        // Only a running, visible board schedules another update.
        updateRunning();
    }

    function pause() {
        manualPaused = true;
        updateRunning();
    }

    function updateBoardData() {
        canvas.dataset.columns = String(columns);
        canvas.dataset.rows = String(rows);
        canvas.dataset.liveCells = String(liveCells);
        canvas.dataset.generation = String(generation);
    }

    function announce(message, includeCell = false) {
        if (!status) return;
        const selected = includeCell
            ? ` Row ${cursor.y + 1}, column ${cursor.x + 1}: ${grid[cursor.y][cursor.x] ? "alive" : "empty"}.`
            : "";
        status.textContent = `${message} ${running ? "Playing" : "Paused"}. ${liveCells} live ${liveCells === 1 ? "cell" : "cells"}. Generation ${generation}.${selected}`;
    }

    function readRules() {
        birthRules = new Set(birthInputs.filter(input => input.checked).map(input => Number(input.value)));
        survivalRules = new Set(survivalInputs.filter(input => input.checked).map(input => Number(input.value)));
    }

    function ruleChanged() {
        cancelAutoStart();
        readRules();
        const births = [...birthRules].join(", ") || "none";
        const survives = [...survivalRules].join(", ") || "none";
        announce(`Rules changed. Birth neighbors: ${births}. Survival neighbors: ${survives}.`);
    }

    function fitFont(context2d) {
        let size = Math.max(8, Math.floor(rows * 0.4));
        context2d.font = `700 ${size}px ${fontFamily}`;
        const width = context2d.measureText(phrase).width;
        if (width > columns * 0.86) {
            size = Math.max(8, Math.floor(size * columns * 0.86 / width));
            context2d.font = `700 ${size}px ${fontFamily}`;
        }
    }

    function seedFromText() {
        const offscreen = document.createElement("canvas");
        offscreen.width = columns;
        offscreen.height = rows;
        const offContext = offscreen.getContext("2d");
        offContext.fillStyle = "#000";
        offContext.textAlign = "center";
        offContext.textBaseline = "middle";
        fitFont(offContext);
        offContext.fillText(phrase, columns / 2, rows / 2);
        const pixels = offContext.getImageData(0, 0, columns, rows).data;
        liveCells = 0;
        generation = 0;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < columns; x++) {
                grid[y][x] = pixels[(y * columns + x) * 4 + 3] > 10 || Math.random() < 0.014 ? 1 : 0;
                liveCells += grid[y][x];
            }
        }
        updateBoardData();
    }

    function clearBoard() {
        for (const row of grid) row.fill(0);
        liveCells = 0;
        generation = 0;
        initialSeedPending = false;
        updateBoardData();
    }

    function loadGlider() {
        clearBoard();
        // This preset restores Conway's rules so its evolution is predictable.
        birthInputs.forEach(input => { input.checked = Number(input.value) === 3; });
        survivalInputs.forEach(input => { input.checked = [2, 3].includes(Number(input.value)); });
        readRules();
        const x = Math.max(0, Math.floor(columns / 2) - 1);
        const y = Math.max(0, Math.floor(rows / 2) - 1);
        for (const [dx, dy] of [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]) {
            const nx = (x + dx) % columns;
            const ny = (y + dy) % rows;
            if (!grid[ny][nx]) {
                grid[ny][nx] = 1;
                liveCells++;
            }
        }
        cursor = { x, y };
        updateBoardData();
    }

    function countNeighbors(x, y) {
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                count += grid[(y + dy + rows) % rows][(x + dx + columns) % columns];
            }
        }
        return count;
    }

    function step() {
        liveCells = 0;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < columns; x++) {
                const neighbors = countNeighbors(x, y);
                nextGrid[y][x] = (grid[y][x] ? survivalRules : birthRules).has(neighbors) ? 1 : 0;
                liveCells += nextGrid[y][x];
            }
        }
        [grid, nextGrid] = [nextGrid, grid];
        generation++;
        updateBoardData();
        // Extinction is an ordinary outcome; only Reseed replaces the board.
    }

    function resizeCanvas() {
        const rect = hero.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        renderWidth = Math.max(1, rect.width);
        renderHeight = Math.max(1, rect.height);
        cellWidth = renderWidth / columns;
        cellHeight = renderHeight / rows;
        canvas.width = Math.round(renderWidth * dpr);
        canvas.height = Math.round(renderHeight * dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
    }

    function draw() {
        context.clearRect(0, 0, renderWidth, renderHeight);
        context.fillStyle = liveColor;
        const gapX = Math.min(1, cellWidth * 0.2);
        const gapY = Math.min(1, cellHeight * 0.2);
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < columns; x++) {
                if (grid[y][x]) {
                    context.fillRect(x * cellWidth + gapX / 2, y * cellHeight + gapY / 2,
                        cellWidth - gapX, cellHeight - gapY);
                }
            }
        }
        if (document.activeElement === canvas || drawMode) {
            context.strokeStyle = cursorColor;
            context.lineWidth = 2;
            context.strokeRect(cursor.x * cellWidth, cursor.y * cellHeight, cellWidth, cellHeight);
        }
    }

    function finishPointer() {
        const pointer = drawingPointer;
        drawingPointer = null;
        previousDrawCell = null;
        if (pointer !== null && canvas.hasPointerCapture?.(pointer)) {
            canvas.releasePointerCapture(pointer);
        }
    }

    function setDrawMode(enabled) {
        drawMode = enabled;
        if (!enabled) finishPointer();
        canvas.dataset.drawMode = String(enabled);
        canvas.style.touchAction = enabled ? "none" : "pan-y pinch-zoom";
        drawButton?.setAttribute("aria-pressed", String(enabled));
        draw();
    }

    function paintCell(x, y) {
        if (!grid[y][x]) {
            grid[y][x] = 1;
            liveCells++;
        }
    }

    function paintFromEvent(event) {
        const rect = canvas.getBoundingClientRect();
        const x = Math.floor((event.clientX - rect.left) * columns / rect.width);
        const y = Math.floor((event.clientY - rect.top) * rows / rect.height);
        if (x < 0 || y < 0 || x >= columns || y >= rows) return;
        initialSeedPending = false;
        // Fill skipped cells during a fast drag, without changing the board's rules.
        const previous = previousDrawCell || { x, y };
        const distance = Math.max(Math.abs(x - previous.x), Math.abs(y - previous.y));
        for (let i = 0; i <= distance; i++) {
            const fraction = distance ? i / distance : 0;
            paintCell(Math.round(previous.x + (x - previous.x) * fraction),
                Math.round(previous.y + (y - previous.y) * fraction));
        }
        previousDrawCell = cursor = { x, y };
        updateBoardData();
        draw();
    }

    pauseButton?.addEventListener("click", () => {
        cancelAutoStart();
        if (running) pause();
        else {
            manualPaused = false;
            motionOptIn = true; // Explicit Play opts into this demo even with reduced motion.
            setDrawMode(false);
            updateRunning();
        }
        announce(running ? "Playback started." : "Playback paused.");
    });
    reseedButton?.addEventListener("click", () => {
        cancelAutoStart();
        pause();
        initialSeedPending = true;
        if (ready) seedFromText();
        draw();
        announce(ready ? "Board reseeded. Rules retained." : "Preparing the lettering before reseeding.");
    });
    clearButton?.addEventListener("click", () => {
        cancelAutoStart();
        pause();
        clearBoard();
        draw();
        announce("Board cleared.");
    });
    stepButton?.addEventListener("click", () => {
        cancelAutoStart();
        pause();
        initialSeedPending = false;
        step();
        draw();
        announce("Advanced one generation.");
    });
    presetButton?.addEventListener("click", () => {
        cancelAutoStart();
        pause();
        loadGlider();
        draw();
        announce("Glider loaded. Birth 3 and survival 2, 3 restored.");
    });
    drawButton?.addEventListener("click", () => {
        cancelAutoStart();
        pause();
        setDrawMode(!drawMode);
        announce(drawMode ? "Draw mode on. Drag to add cells; Escape exits." : "Draw mode off. Scrolling and pinch zoom enabled.");
    });
    for (const input of [...birthInputs, ...survivalInputs]) input.addEventListener("change", ruleChanged);

    // A focus, gesture, or key in the demo cancels its delayed automatic start.
    for (const target of [controls, canvas]) {
        for (const event of ["pointerdown", "keydown", "focusin"]) target?.addEventListener(event, cancelAutoStart, true);
    }
    canvas.addEventListener("focus", () => {
        draw();
        announce("Use arrow keys to inspect cells and Space to toggle. Editing pauses playback.", true);
    });
    canvas.addEventListener("blur", draw);
    canvas.addEventListener("keydown", event => {
        const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const move = moves[event.key];
        if (!move && event.key !== " " && event.key !== "Spacebar" && event.key !== "Escape") return;
        event.preventDefault();
        if (event.key === "Escape") {
            setDrawMode(false);
            announce("Draw mode off. Scrolling and pinch zoom enabled.");
            return;
        }
        pause();
        if (move) {
            cursor.x = (cursor.x + move[0] + columns) % columns;
            cursor.y = (cursor.y + move[1] + rows) % rows;
        } else {
            initialSeedPending = false;
            grid[cursor.y][cursor.x] = grid[cursor.y][cursor.x] ? 0 : 1;
            liveCells += grid[cursor.y][cursor.x] ? 1 : -1;
            updateBoardData();
        }
        draw();
        announce(move ? "Selected cell." : "Cell toggled.", true);
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && drawMode && event.target !== canvas) {
            cancelAutoStart();
            setDrawMode(false);
            announce("Draw mode off. Scrolling and pinch zoom enabled.");
        }
    });
    canvas.addEventListener("pointerdown", event => {
        if (!drawMode || !event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        pause();
        drawingPointer = event.pointerId;
        canvas.setPointerCapture?.(event.pointerId);
        paintFromEvent(event);
    });
    canvas.addEventListener("pointermove", event => {
        if (drawMode && drawingPointer === event.pointerId) paintFromEvent(event);
    });
    canvas.addEventListener("pointerup", event => {
        if (drawingPointer !== event.pointerId) return;
        finishPointer();
        announce("Cells drawn.", true);
    });
    for (const event of ["pointercancel", "lostpointercapture"]) canvas.addEventListener(event, finishPointer);

    document.addEventListener("visibilitychange", updateRunning);
    listenForPreference(motionQuery, () => {
        cancelAutoStart();
        if (motionQuery.matches) {
            motionOptIn = false;
            pause();
            announce("Reduced motion enabled. Use Play to opt into this demo.");
        } else {
            updateRunning();
            announce("Reduced motion disabled. Use Play when ready.");
        }
    });
    listenForPreference(darkQuery, () => {
        if (!selectedTheme) applyTheme(systemTheme());
    });
    themeToggle?.addEventListener("click", toggleTheme);

    if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(entries => {
            heroVisible = entries[0].isIntersecting;
            updateRunning();
        });
        observer.observe(hero);
    }
    if ("ResizeObserver" in window) {
        const observer = new ResizeObserver(resizeCanvas);
        observer.observe(hero);
    }
    window.addEventListener("resize", resizeCanvas);

    applyTheme(activeTheme);
    readRules();
    updateBoardData();
    setDrawMode(false);
    resizeCanvas();
    updateRunning();

    async function initialize() {
        if (document.fonts?.load) {
            try {
                await document.fonts.load('700 24px "Space Grotesk"', phrase);
            } catch {
                // The demo remains usable with a fallback if the font cannot load.
            }
        }
        ready = true;
        if (initialSeedPending) seedFromText();
        draw();
        updateRunning();
        if (motionQuery.matches) {
            announce("Reduced motion is enabled. Use Play to opt into this demo.");
        } else if (interactionOccurred) {
            announce("Simulation ready.");
        } else if (status) {
            status.textContent = `Simulation ready. Starting board: ${liveCells} live cells. Use the controls, or focus the board to inspect and edit cells.`;
        }
        if (!interactionOccurred && !motionQuery.matches) {
            autoStartTimer = window.setTimeout(() => {
                autoStartTimer = null;
                if (interactionOccurred || motionQuery.matches) return;
                manualPaused = false;
                updateRunning();
                // Keep the live region quiet during automatic animation.
            }, 3000);
        }
    }
    initialize();
})();
