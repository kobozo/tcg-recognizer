FROM python:3.12-slim
WORKDIR /app
# opencv-python-headless needs these shared libs to import cleanly; libgomp1
# also satisfies onnxruntime (used by the optional EMBEDDER=onnx backend, whose
# DINOv2 model is lazily downloaded at runtime to the mounted /models cache — no
# model is baked into the image).
RUN apt-get update \
  && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 \
  && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# CPU-only PyTorch — used solely to train the small projection head
# (sub-project 3). The CPU wheel keeps the image lean (no CUDA). The head is
# APPLIED in pure numpy at inference, so torch is a trainer-only dependency.
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
COPY config.yaml .
COPY src ./src
# GIT_PYTHON_REFRESH is set in docker-compose so MLflow's GitPython probe
# does not crash when git is absent.
WORKDIR /app/src
CMD ["python", "main.py"]
