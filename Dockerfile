# Evolvarium — numpy is the only dependency, so the image stays small.
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY ReinLife/ ./ReinLife/
COPY web/ ./web/

ENV HOST=0.0.0.0 PORT=8765 PYTHONUNBUFFERED=1
EXPOSE 8765

# Evolved champions are written back to this file. Mount a volume over it to
# keep a deployment's progress across container restarts.
VOLUME ["/app/web"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:'+os.environ['PORT']+'/healthz',timeout=4)"

CMD ["python", "web/server.py"]
