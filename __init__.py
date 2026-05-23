from .multi_lora_loader import MultiLoRALoader, PowerLTXLoraLoaderExtra

NODE_CLASS_MAPPINGS = {
    "MultiLoRALoader": MultiLoRALoader,
    "PowerLTXLoraLoaderExtra": PowerLTXLoraLoaderExtra,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MultiLoRALoader": "Multi LoRA Loader",
    "PowerLTXLoraLoaderExtra": "Power LTX LoRA Loader Extra (Deprecated)",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
