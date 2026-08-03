FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# lib/ is shared by every island: the process tap and the declared distortion.
COPY lib ./lib
COPY selftest.py ./
COPY opcda ./opcda
COPY opcua ./opcua

# Which island this container serves is chosen by ISLAND at run time, so one
# image covers every vendor simulator. Keeps the VPS footprint honest: the
# alternative was a container per machine, and PR-13 says cheap VPS.
ENV ISLAND=opcda

EXPOSE 4843

CMD ["sh", "-c", "python ${ISLAND}/server.py"]
