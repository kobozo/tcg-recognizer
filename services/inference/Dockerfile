FROM python:3.12-slim AS base
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
COPY app ./app
EXPOSE 8001
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8001/health').status==200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
