import os
import json
import folder_paths
import comfy.lora
import comfy.sd
import comfy.utils


class PowerLTXLoraLoaderExtra:
    @classmethod
    def INPUT_TYPES(s):
        lora_list = ["None"] + folder_paths.get_filename_list("loras")
        return {
            "required": {
                # lora_data is managed entirely by the JS frontend via
                # node.properties — the hidden widget bridges data to Python.
                "lora_data": ("STRING", {"default": "[]", "multiline": False}),
                # When True, enables LTX-specific per-layer strength controls
                # (Vid, V2A, Aud, A2V, Other).  When False, uses standard
                # uniform LoRA application with just the STR value.
                "ltx_mode": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                # Model and CLIP are both optional — the node can still
                # output lora_data JSON even when neither is connected.
                "model": ("MODEL",),
                "clip": ("CLIP",),
            },
            "hidden": {"available_loras": (lora_list,)}
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("model", "clip", "lora_data")
    FUNCTION = "load_loras"
    CATEGORY = "loaders"

    # ─────────────────────────────────────────────
    #  Helper: Build rich LoRA info list
    # ─────────────────────────────────────────────

    @staticmethod
    def _build_lora_info(data, ltx_mode=False):
        """
        Build a list of rich LoRA info dicts from raw row data.

        Includes every row that has a LoRA selected (lora != "None"),
        regardless of whether it is enabled or disabled.  Each dict
        carries an ``enabled`` flag so consumers can filter as needed.

        When ltx_mode is False, the LTX-specific fields (video,
        video_to_audio, audio, audio_to_video, other) are omitted
        from the output.

        Returns:
            list[dict]: One entry per selected LoRA.
        """
        result = []
        for row in data:
            lora_name = row.get("lora")
            if not lora_name or lora_name == "None":
                continue

            full_path = folder_paths.get_full_path("loras", lora_name)

            # Fetch sidecar metadata (.json) if it exists next to the weights file
            info_data = {}
            if full_path:
                info_file = os.path.splitext(full_path)[0] + ".json"
                if os.path.exists(info_file):
                    try:
                        with open(info_file, "r", encoding="utf-8") as f:
                            info_data = json.load(f)
                    except Exception:
                        pass

            entry = {
                "name":            lora_name,
                "path":            full_path,
                "enabled":         bool(row.get("on", True)),
                "strength_model":  float(row.get("str", 1.0)),
                "metadata":        info_data,
            }

            if ltx_mode:
                entry["video"]           = float(row.get("vid", 1.0))
                entry["video_to_audio"]  = float(row.get("v2a", 1.0))
                entry["audio"]           = float(row.get("aud", 1.0))
                entry["audio_to_video"]  = float(row.get("a2v", 1.0))
                entry["other"]           = float(row.get("other", 1.0))

            result.append(entry)
        return result

    # ─────────────────────────────────────────────
    #  Public API: loras()
    # ─────────────────────────────────────────────

    @classmethod
    def loras(cls, prompt_node: dict):
        """
        Returns a list of rich LoRA dicts for every LoRA that has been
        selected in the UI (lora != "None").  Each entry includes an
        ``enabled`` field so callers can distinguish active vs. disabled
        entries.  Useful for external scripts parsing the prompt dictionary.
        """
        inputs = prompt_node.get("inputs", {})
        lora_data_str = inputs.get("lora_data", "[]")
        ltx_mode = inputs.get("ltx_mode", False)
        try:
            data = json.loads(lora_data_str)
        except Exception:
            return []
        return cls._build_lora_info(data, ltx_mode=ltx_mode)

    # ─────────────────────────────────────────────
    #  Main Execution
    # ─────────────────────────────────────────────

    def load_loras(self, lora_data, ltx_mode=False, model=None, clip=None,
                   available_loras=None):
        """
        Applies every active LoRA to the model (and optionally CLIP) and
        returns the patched model, CLIP, and a JSON string of rich LoRA
        info (for the lora_data output port).

        When no model/clip is connected, LoRA loading is skipped for that
        component but the lora_data JSON output is still produced.

        Two modes of operation:

        - **Standard mode** (ltx_mode=False): Uses ComfyUI's built-in
          ``comfy.sd.load_lora_for_models()`` to apply the LoRA uniformly
          to both model and CLIP using the STR strength value.

        - **LTX mode** (ltx_mode=True): Applies per-layer strength
          filtering specific to LTX2 models.  The Vid, V2A, Aud, A2V,
          and Other columns control individual attention layer strengths.
          CLIP is passed through unchanged (LTX LoRAs don't train CLIP).
        """
        try:
            data = json.loads(lora_data)
        except Exception:
            return (model, clip, "[]")

        # Build the rich info list for the STRING output
        lora_info_json = json.dumps(
            self._build_lora_info(data, ltx_mode=ltx_mode), indent=2
        )

        # If no model is connected, skip LoRA patching entirely
        if model is None:
            return (None, clip, lora_info_json)

        # Clone model to prevent mutating previous nodes
        new_model = model.clone()
        new_clip = clip

        for row in data:
            # Only apply LoRAs that are enabled, selected, and have non-zero strength
            if not row.get("on") or row.get("lora") == "None":
                continue
            if float(row.get("str", 1.0)) == 0:
                continue

            lora_name = row.get("lora")
            path = folder_paths.get_full_path("loras", lora_name)
            if not path:
                print(f"[PowerLTXLoraLoaderExtra] Warning: LoRA not found: {lora_name}")
                continue

            strength_model = float(row.get("str", 1.0))

            if ltx_mode:
                # ── LTX mode: per-layer attention strength filtering ──
                video           = float(row.get("vid", 1.0))
                video_to_audio  = float(row.get("v2a", 1.0))
                audio           = float(row.get("aud", 1.0))
                audio_to_video  = float(row.get("a2v", 1.0))
                other           = float(row.get("other", 1.0))

                lora = comfy.utils.load_torch_file(path, safe_load=True)

                key_map = {}
                key_map = comfy.lora.model_lora_keys_unet(new_model.model, key_map)
                loaded = comfy.lora.load_lora(lora, key_map)

                keys_to_delete = []

                for key in list(loaded.keys()):
                    key_str = key if isinstance(key, str) else (
                        key[0] if isinstance(key, tuple) else str(key)
                    )
                    strength_multiplier = None

                    # Prioritised keyword matching for LTX2 attention layers
                    if "video_to_audio_attn" in key_str:
                        strength_multiplier = video_to_audio
                    elif "audio_to_video_attn" in key_str:
                        strength_multiplier = audio_to_video
                    elif "audio_attn" in key_str or "audio_ff.net" in key_str:
                        strength_multiplier = audio
                    elif "attn" in key_str or "ff.net" in key_str:
                        strength_multiplier = video
                    else:
                        strength_multiplier = other

                    # Apply multiplier to the alpha weights
                    if strength_multiplier is not None:
                        if strength_multiplier == 0:
                            keys_to_delete.append(key)
                        elif strength_multiplier != 1.0:
                            value = loaded[key]
                            if hasattr(value, "weights"):
                                weights_list = list(value.weights)
                                current_alpha = (
                                    weights_list[2]
                                    if weights_list[2] is not None
                                    else 1.0
                                )
                                weights_list[2] = current_alpha * strength_multiplier
                                loaded[key].weights = tuple(weights_list)

                for key in keys_to_delete:
                    if key in loaded:
                        del loaded[key]

                new_model.add_patches(loaded, strength_model)
                # CLIP unchanged in LTX mode (LTX LoRAs don't train CLIP)

            else:
                # ── Standard mode: uniform LoRA application ──
                lora_file = comfy.utils.load_torch_file(path, safe_load=True)
                new_model, new_clip = comfy.sd.load_lora_for_models(
                    new_model, new_clip, lora_file,
                    strength_model, strength_model
                )

        return (new_model, new_clip, lora_info_json)
