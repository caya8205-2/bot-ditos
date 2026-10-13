import io
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import torch
import torch.nn.functional as functional
from PIL import Image, ImageOps
from transformers import AutoModelForImageSegmentation


MODEL_ID = os.environ.get("BIREFNET_MODEL_ID", "ZhengPeng7/BiRefNet_lite")
HOST = "127.0.0.1"
PORT = int(os.environ.get("BIREFNET_PORT", "8765"))
RESOLUTION = int(os.environ.get("BIREFNET_RESOLUTION", "1024"))
MAX_IMAGE_BYTES = 15 * 1024 * 1024
MODEL_LOCK = threading.Lock()


def load_model():
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = AutoModelForImageSegmentation.from_pretrained(
        MODEL_ID,
        trust_remote_code=True,
        torch_dtype=torch.float32,
    )
    model.to(device)
    model.eval()
    print(f"[BiRefNet] Model {MODEL_ID} siap di {device}.", flush=True)
    return model, device


MODEL, DEVICE = load_model()


def remove_background(image_bytes):
    with Image.open(io.BytesIO(image_bytes)) as source:
        original = ImageOps.exif_transpose(source).convert("RGB")

    resized = original.resize((RESOLUTION, RESOLUTION), Image.Resampling.BILINEAR)
    pixels = np.asarray(resized, dtype=np.float32) / 255.0
    tensor = torch.from_numpy(pixels).permute(2, 0, 1)
    mean = torch.tensor((0.485, 0.456, 0.406), dtype=torch.float32)[:, None, None]
    std = torch.tensor((0.229, 0.224, 0.225), dtype=torch.float32)[:, None, None]
    tensor = ((tensor - mean) / std).unsqueeze(0).to(DEVICE)

    with MODEL_LOCK, torch.inference_mode():
        prediction = MODEL(tensor)[-1].sigmoid()
        prediction = functional.interpolate(
            prediction,
            size=(original.height, original.width),
            mode="bilinear",
            align_corners=True,
        )[0, 0]

    alpha = (prediction.clamp(0, 1).cpu().numpy() * 255).astype(np.uint8)
    output = original.convert("RGBA")
    output.putalpha(Image.fromarray(alpha, mode="L"))
    buffer = io.BytesIO()
    output.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        body = json.dumps({"ok": True, "model": MODEL_ID, "device": str(DEVICE)}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/remove-bg":
            self.send_error(404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_IMAGE_BYTES:
                self.send_error(413, "Image must be between 1 byte and 15 MB")
                return

            result = remove_background(self.rfile.read(length))
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(result)))
            self.end_headers()
            self.wfile.write(result)
        except Exception as error:
            print(f"[BiRefNet] Gagal memproses gambar: {error}", flush=True)
            self.send_error(500, "Background removal failed")

    def log_message(self, format_string, *args):
        print(f"[BiRefNet] {format_string % args}", flush=True)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[BiRefNet] Service lokal aktif di http://{HOST}:{PORT}", flush=True)
    server.serve_forever()
