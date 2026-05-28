import { app } from "../../scripts/app.js";

// ═══════════════════════════════════════════════════════════════
//  MultiLoRA Cycle — JS Frontend
// ═══════════════════════════════════════════════════════════════
//
//  Companion node for MultiLoRALoader.  Cycles through LoRAs and
//  strength values across queue runs.  All mutation of the connected
//  loader's lora_data happens in the beforeQueued hook, BEFORE
//  graphToPrompt() serialises the graph — so the prompt JSON, the
//  EXTRA_PNGINFO workflow metadata, and the lora_data STRING output
//  all reflect the correct state automatically.
//
//  The cycle node's Python side is minimal — it just packages
//  informational metadata.  The real work is here in JS.
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
//  CSS Injection (once per page load)
// ─────────────────────────────────────────────

let _cycleStylesInjected = false;

function injectCycleStyles() {
    if (_cycleStylesInjected) return;
    _cycleStylesInjected = true;

    const style = document.createElement("style");
    style.textContent = `
/* ── MultiLoRA Cycle Display ── */

.mll-cycle-display {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    color: #ccc;
    text-align: center;
    padding: 4px 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    user-select: none;
    -webkit-user-select: none;
    pointer-events: none;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 3px;
    margin: 0 4px;
    line-height: 16px;
    height: 24px;
    min-height: 24px;
    box-sizing: border-box;
}
`;
    document.head.appendChild(style);
}

app.registerExtension({
    name: "phazei.MultiLoRACycle",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "MultiLoRA_Cycle") return;

        // ─────────────────────────────────────────────
        //  Constants
        // ─────────────────────────────────────────────

        /** Symbol used as a guard to skip increment on the first queue */
        const HAS_EXECUTED = Symbol("mllCycle_hasExecuted");

        // ─────────────────────────────────────────────
        //  Helpers
        // ─────────────────────────────────────────────

        /**
         * Parses the comma-separated strengths string into an array of numbers.
         * Invalid entries are silently dropped.  Returns [1.0] if empty.
         *
         * @param {string} str
         * @returns {number[]}
         */
        const parseStrengths = (str) => {
            const result = [];
            for (const s of (str || "").split(",")) {
                const trimmed = s.trim();
                if (trimmed === "") continue;
                const n = parseFloat(trimmed);
                if (!isNaN(n)) result.push(n);
            }
            return result.length > 0 ? result : [1.0];
        };

        /**
         * Finds the MultiLoRALoader node connected to this cycle node's
         * "load_options" output.  Walks the LiteGraph link graph.
         *
         * @param {LGraphNode} cycleNode
         * @returns {LGraphNode|null}
         */
        const findConnectedLoader = (cycleNode) => {
            const graph = cycleNode.graph;
            if (!graph) return null;

            // Find the "load_options" output slot
            const outputIdx = cycleNode.outputs?.findIndex(
                o => o.name === "load_options"
            );
            if (outputIdx == null || outputIdx < 0) return null;

            const output = cycleNode.outputs[outputIdx];
            if (!output.links || output.links.length === 0) return null;

            // Follow the first link to the connected node
            const linkId = output.links[0];
            const link = graph.links?.[linkId] ?? graph._links?.get?.(linkId);
            if (!link) return null;

            const targetNode = graph.getNodeById(link.target_id);
            if (!targetNode) return null;

            // Verify it's a MultiLoRALoader
            if (targetNode.comfyClass === "MultiLoRALoader" ||
                targetNode.type === "MultiLoRALoader") {
                return targetNode;
            }

            return null;
        };

        /**
         * Gets the list of non-"None" LoRA rows from a MultiLoRALoader node.
         *
         * @param {LGraphNode} loaderNode
         * @returns {object[]}
         */
        const getLoaderLoras = (loaderNode) => {
            try {
                const allRows = JSON.parse(loaderNode.properties?.lora_data || "[]");
                return allRows.filter(row => row.lora && row.lora !== "None");
            } catch {
                return [];
            }
        };

        /**
         * Syncs a MultiLoRALoader node's lora_data via its public
         * updateLoraData() method — handles backend sync, UI re-render,
         * and node resize in one call.
         *
         * @param {LGraphNode} loaderNode
         */
        const syncLoader = (loaderNode) => {
            if (typeof loaderNode.updateLoraData === "function") {
                loaderNode.updateLoraData(loaderNode.properties.lora_data);
            }
        };

        /**
         * Mutates a MultiLoRALoader's lora_data: disables all rows,
         * then enables the target row and sets its strength.
         *
         * @param {LGraphNode} loaderNode
         * @param {number}     loraIdx     - Index into non-"None" rows
         * @param {number}     strength    - Strength value to set
         * @returns {boolean} true if mutation was applied
         */
        const mutateLoader = (loaderNode, loraIdx, strength) => {
            let allRows;
            try {
                allRows = JSON.parse(loaderNode.properties?.lora_data || "[]");
            } catch {
                return false;
            }

            // Build index map: position in non-"None" list → position in allRows
            const validIndices = [];
            for (let i = 0; i < allRows.length; i++) {
                if (allRows[i].lora && allRows[i].lora !== "None") {
                    validIndices.push(i);
                }
            }

            if (validIndices.length === 0) return false;

            // Disable all rows
            for (const row of allRows) {
                row.on = false;
            }

            // Enable target row if in bounds
            if (loraIdx >= 0 && loraIdx < validIndices.length) {
                const realIdx = validIndices[loraIdx];
                allRows[realIdx].on = true;
                allRows[realIdx].str = strength;
            }
            // If out of bounds, all stay disabled (no LoRA applied)

            loaderNode.properties.lora_data = JSON.stringify(allRows);
            syncLoader(loaderNode);
            return true;
        };

        /**
         * Formats a LoRA filename for display: strips extension.
         *
         * @param {string} loraPath
         * @returns {string}
         */
        const formatLoraName = (loraPath) => {
            if (!loraPath || loraPath === "None") return "None";
            return loraPath.replace(/\.[^.]+$/, "");
        };

        /**
         * Gets a widget by name from a node.
         *
         * @param {LGraphNode} node
         * @param {string}     name
         * @returns {IBaseWidget|undefined}
         */
        const getWidget = (node, name) => {
            return node.widgets?.find(w => w.name === name);
        };

        /**
         * Updates the display text showing current cycle state.
         * Writes directly to the node's _mllCycleDisplayEl DOM element.
         *
         * @param {LGraphNode} node       - The cycle node
         * @param {LGraphNode|null} loader - Connected loader (or null)
         */
        const updateDisplay = (node, loader) => {
            const el = node._mllCycleDisplayEl;
            if (!el) return;

            // Widget values are 1-based; convert to 0-based for array access
            const loraIdx1 = getWidget(node, "lora_index")?.value ?? 1;
            const strIdx1 = getWidget(node, "strength_index")?.value ?? 1;
            const loraIdx = loraIdx1 - 1;
            const strIdx = strIdx1 - 1;
            const strengths = parseStrengths(getWidget(node, "strengths")?.value);

            if (!loader) {
                el.textContent = "Not connected";
                return;
            }

            const loras = getLoaderLoras(loader);
            const loraCount = loras.length;
            const strCount = strengths.length;

            if (loraCount === 0) {
                el.textContent = "No LoRAs in loader";
                return;
            }

            if (loraIdx >= loraCount) {
                el.textContent = `Done (${loraCount} LoRAs x ${strCount} strengths)`;
                return;
            }

            const clampedLoraIdx = Math.max(0, Math.min(loraIdx, loraCount - 1));
            const clampedStrIdx = Math.max(0, Math.min(strIdx, strCount - 1));
            const loraName = formatLoraName(loras[clampedLoraIdx]?.lora || "?");
            const strValue = strengths[clampedStrIdx];

            el.textContent = (
                `${loraName} (${loraIdx1}/${loraCount})` +
                ` | STR: ${strValue} (${strIdx1}/${strCount})`
            );
        };

        // ─────────────────────────────────────────────
        //  Node Lifecycle — onNodeCreated
        // ─────────────────────────────────────────────

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnNodeCreated?.apply(this, arguments);

            injectCycleStyles();

            const nodeRef = this;

            // Guard flag: true while beforeQueued is programmatically
            // updating widget values, so the widget callbacks don't
            // reset HAS_EXECUTED during auto-increment.
            this._mllAutoIncrementing = false;

            // ── Display element (read-only DOM text at top of node) ──
            const displayEl = document.createElement("div");
            displayEl.className = "mll-cycle-display";
            displayEl.style.height = "24px";
            displayEl.style.minHeight = "24px";
            displayEl.textContent = "Not connected";
            this._mllCycleDisplayEl = displayEl;

            const displayDomWidget = this.addDOMWidget(
                "_cycle_display", "custom", displayEl, {
                    hideOnZoom: true,
                    getMinHeight: () => 44,
                    getMaxHeight: () => 44,
                    getHeight: () => 44,
                    getValue: () => displayEl.textContent,
                    setValue: (v) => { displayEl.textContent = v; },
                }
            );
            displayDomWidget.serialize = false;

            // ── Attach beforeQueued to a widget for the queue hook ──
            // We attach it to the lora_index widget since ComfyUI
            // iterates all widgets and calls beforeQueued on each.
            const loraIdxWidget = getWidget(this, "lora_index");
            const strIdxWidget = getWidget(this, "strength_index");

            if (loraIdxWidget) {
                loraIdxWidget[HAS_EXECUTED] = false;

                loraIdxWidget.beforeQueued = (options) => {
                    // Allow cycle to run on partial execution too — the
                    // loader mutation should always reflect current state.
                    // if (options?.isPartialExecution) return;

                    const modeWidget = getWidget(nodeRef, "mode");
                    const loopWidget = getWidget(nodeRef, "loop");
                    const strengthsWidget = getWidget(nodeRef, "strengths");

                    const mode = modeWidget?.value ?? "fixed";
                    const loop = loopWidget?.value ?? false;
                    const strengths = parseStrengths(strengthsWidget?.value);
                    const strCount = strengths.length;

                    // Find the connected loader
                    const loader = findConnectedLoader(nodeRef);

                    if (mode === "increment" && loraIdxWidget[HAS_EXECUTED]) {
                        // ── Auto-increment logic (widgets are 1-based) ──
                        const loraCount = loader ? getLoaderLoras(loader).length : 0;
                        const currentLIdx = loraIdxWidget.value ?? 1;

                        // Only increment if we haven't already passed the end
                        if (loraCount > 0 && (loop || currentLIdx <= loraCount)) {
                            let sIdx = (strIdxWidget?.value ?? 1) + 1;
                            let lIdx = currentLIdx;

                            if (sIdx > strCount) {
                                // Strength list exhausted → advance to next LoRA
                                sIdx = 1;
                                lIdx += 1;

                                if (lIdx > loraCount) {
                                    if (loop) {
                                        lIdx = 1;
                                    } else {
                                        // One past the end — all rows will be
                                        // disabled (out of bounds).
                                        lIdx = loraCount + 1;
                                    }
                                }
                            }

                            // Write back to widgets (1-based)
                            nodeRef._mllAutoIncrementing = true;
                            loraIdxWidget.value = lIdx;
                            if (strIdxWidget) strIdxWidget.value = sIdx;
                            nodeRef._mllAutoIncrementing = false;
                        }
                    }

                    loraIdxWidget[HAS_EXECUTED] = true;

                    // ── Mutate the connected loader's lora_data ──
                    // Convert 1-based widget values to 0-based array indices
                    if (loader) {
                        const lIdx = (loraIdxWidget.value ?? 1) - 1;
                        const sIdx = (strIdxWidget?.value ?? 1) - 1;
                        const clampedSIdx = Math.max(0, Math.min(sIdx, strCount - 1));
                        const strength = strengths[clampedSIdx];

                        mutateLoader(loader, lIdx, strength);
                    }

                    // ── Update display ──
                    updateDisplay(nodeRef, loader);
                    nodeRef.setDirtyCanvas?.(true, true);
                };
            }

            // ── Update display whenever widget values change ──
            // Override callbacks on the index/strengths widgets to
            // refresh the display text when the user manually edits.
            const refreshDisplay = () => {
                const loader = findConnectedLoader(nodeRef);
                updateDisplay(nodeRef, loader);
                nodeRef.setDirtyCanvas?.(true, true);
            };

            for (const wName of ["lora_index", "strength_index", "strengths"]) {
                const w = getWidget(this, wName);
                if (w) {
                    const origCb = w.callback;
                    w.callback = function (...args) {
                        origCb?.apply(this, args);
                        // Reset HAS_EXECUTED when the user manually edits
                        // an index, so the next run uses their value as-is
                        // before resuming auto-increment.
                        if (!nodeRef._mllAutoIncrementing && loraIdxWidget) {
                            loraIdxWidget[HAS_EXECUTED] = false;
                        }
                        refreshDisplay();
                    };
                }
            }

            // Initial display update (deferred to let the graph settle)
            requestAnimationFrame(() => refreshDisplay());
        };

        // ─────────────────────────────────────────────
        //  Configure — re-render display after load
        // ─────────────────────────────────────────────

        const origConfigure = nodeType.prototype.configure;
        nodeType.prototype.configure = function (data) {
            origConfigure?.apply(this, arguments);

            // Reset the HAS_EXECUTED guard when loading from a saved workflow
            // so the first queue after load doesn't increment.
            const loraIdxWidget = getWidget(this, "lora_index");
            if (loraIdxWidget) {
                loraIdxWidget[HAS_EXECUTED] = false;
            }

            // Refresh display
            requestAnimationFrame(() => {
                const loader = findConnectedLoader(this);
                updateDisplay(this, loader);
                this.setDirtyCanvas?.(true, true);
            });
        };

        // ─────────────────────────────────────────────
        //  Connection change — refresh display
        // ─────────────────────────────────────────────

        const origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (type, slotIdx, isConnected, link, ioSlot) {
            origOnConnectionsChange?.apply(this, arguments);

            // When a connection is made or broken, refresh display
            requestAnimationFrame(() => {
                const loader = findConnectedLoader(this);
                updateDisplay(this, loader);
                this.setDirtyCanvas?.(true, true);
            });
        };
    }
});
