FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 MALLOC_ARENA_MAX=2
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd -m app && chown -R app /app
USER app
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,os;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8080')+'/healthz')" || exit 1
CMD ["gunicorn", "main:app", \
  "--worker-class", "uvicorn.workers.UvicornWorker", \
  "--workers", "4", \
  "--worker-connections", "1000", \
  "--keep-alive", "5", \
  "--timeout", "120", \
  "--graceful-timeout", "30", \
  "--bind", "0.0.0.0:8080", \
  "--log-level", "warning", \
  "--access-logfile", "-"]
