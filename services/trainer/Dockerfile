FROM python:3.12-slim
WORKDIR /app
# opencv-python-headless needs these shared libs to import cleanly.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 \
  && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY config.yaml .
COPY src ./src
# GIT_PYTHON_REFRESH is set in docker-compose so MLflow's GitPython probe
# does not crash when git is absent.
WORKDIR /app/src
CMD ["python", "main.py"]
