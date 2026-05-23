import { app } from "../../scripts/app.js";

// ═══════════════════════════════════════════════════════════════
//  PowerLTXLoraLoaderExtra — Deprecated Stub
// ═══════════════════════════════════════════════════════════════
//
//  This node was renamed to MultiLoRALoader.  This stub keeps old
//  workflows loadable and shows migration instructions with the
//  lora_data visible so users can copy it to the new node.
// ═══════════════════════════════════════════════════════════════

app.registerExtension({
    name: "phazei.PowerLTXLoraLoaderExtra.Deprecated",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "PowerLTXLoraLoaderExtra") return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnNodeCreated?.apply(this, arguments);

            const notice = document.createElement("div");
            notice.style.cssText = "padding: 8px 10px; font-family: Arial, Helvetica, sans-serif;";
            notice.innerHTML = `
                <h2 style="margin: 0 0 6px 0; font-size: 14px; color: #f0a040;">
                    Node Renamed
                </h2>
                <p style="margin: 0; font-size: 11px; color: #ccc; line-height: 1.5;">
                    This node has been renamed to <b style="color: #fff;">Multi LoRA Loader</b>.<br>
                    To migrate: copy the JSON data above,
                    add a new <b style="color: #fff;">Multi LoRA Loader</b> node,
                    click its cog button (<b style="color: #fff;">\u2699</b>),
                    paste the data in, and enable the
                    <b style="color: #4CAF50;">LTX</b> checkbox if needed.
                </p>
            `;

            this.addDOMWidget("deprecation_notice", "custom", notice, {
                getMinHeight: () => 90,
            });
        };
    },
});
