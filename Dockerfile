FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Build static frontend bundle if not already built
RUN python3 frontend/build.py

ENV NEXUSDESK_HOST=0.0.0.0 \
    NEXUSDESK_PORT=9200 \
    PYTHONUNBUFFERED=1

EXPOSE 9200

CMD ["python3", "backend/server.py"]
