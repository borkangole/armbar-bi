"""
ArmBar landing page - depth maps for the 3D photos (computer vision step).

Uses MiDaS v2.1 small (Intel ISL), a pretrained monocular depth-estimation CNN
(EfficientNet-Lite3 encoder), to estimate how far each pixel of a photo is from
the camera. The landing page (web/src/hero3d.js) uses these maps to push each
pixel toward the viewer, turning a flat photo into a 3D surface with real
parallax and pointer lighting.

Input : web/imgs/<name>.webp
Output: web/imgs/<name>-depth.webp   (grayscale, white = near, black = far)

Setup (one time):
    pip install torch torchvision timm opencv-python-headless
    git clone https://github.com/isl-org/MiDaS.git                 pipeline/_models/MiDaS
    git clone https://github.com/rwightman/gen-efficientnet-pytorch pipeline/_models/gen-efficientnet-pytorch
    download https://github.com/isl-org/MiDaS/releases/download/v2_1/midas_v21_small_256.pt
          -> pipeline/_models/midas_v21_small_256.pt
    In pipeline/_models/MiDaS/midas/blocks.py, change the torch.hub.load call for
    "rwightman/gen-efficientnet-pytorch" to the local clone path with source="local".

Run:
    python pipeline/depth_maps.py
"""
import sys
from pathlib import Path

import cv2
import numpy as np
import torch
from torchvision.transforms import Compose

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "pipeline" / "_models"
IMGS = ROOT / "web" / "imgs"
PHOTOS = ["img1", "img2", "img3-portrait", "img4-portrait"]
OUT_MAX_SIDE = 900          # depth maps are smooth, so they can be smaller than the photos

sys.path.insert(0, str(MODELS / "MiDaS"))
from midas.midas_net_custom import MidasNet_small            # noqa: E402
from midas.transforms import Resize, NormalizeImage, PrepareForNet  # noqa: E402

model = MidasNet_small(str(MODELS / "midas_v21_small_256.pt"), features=64, backbone="efficientnet_lite3",
                       exportable=True, non_negative=True, blocks={"expand": True})
model.eval()

transform = Compose([
    Resize(384, 384, resize_target=None, keep_aspect_ratio=True, ensure_multiple_of=32,
           resize_method="upper_bound", image_interpolation_method=cv2.INTER_CUBIC),
    NormalizeImage(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),   # ImageNet statistics
    PrepareForNet(),
])

for name in PHOTOS:
    img = cv2.cvtColor(cv2.imread(str(IMGS / f"{name}.webp")), cv2.COLOR_BGR2RGB) / 255.0
    x = torch.from_numpy(transform({"image": img})["image"]).unsqueeze(0)
    with torch.no_grad():
        pred = model(x)                                          # relative inverse depth (bigger = closer)
        pred = torch.nn.functional.interpolate(pred.unsqueeze(1), size=img.shape[:2],
                                               mode="bicubic", align_corners=False).squeeze().numpy()

    # Normalise with robust percentiles (ignores outliers), then smooth so the
    # 3D mesh doesn't tear at object edges.
    lo, hi = np.percentile(pred, 2), np.percentile(pred, 98)
    depth = np.clip((pred - lo) / (hi - lo), 0, 1).astype(np.float32)
    depth = cv2.GaussianBlur(depth, (0, 0), sigmaX=img.shape[1] / 300)

    h, w = depth.shape
    s = OUT_MAX_SIDE / max(h, w)
    depth = cv2.resize(depth, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(IMGS / f"{name}-depth.webp"), (depth * 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 85])
    print(f"{name}: depth map {depth.shape[1]}x{depth.shape[0]}, mean nearness {depth.mean():.2f}")
