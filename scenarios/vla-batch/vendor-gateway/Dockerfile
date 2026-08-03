FROM python:3.11-slim

WORKDIR /app

# pymssql needs FreeTDS; the slim image does not carry it.
RUN apt-get update && apt-get install -y --no-install-recommends \
        freetds-dev freetds-bin gcc \
 && pip install --no-cache-dir --upgrade pip \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && apt-get purge -y gcc && apt-get autoremove -y

COPY gateway.py sources.yaml selftest.py ./

CMD ["python", "gateway.py"]
