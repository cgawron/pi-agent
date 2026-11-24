FROM node:26-bookworm-slim

# Systemabhängigkeiten installieren:
# - git, curl, ca-certificates: Standard-Tools für Pi und MCP
# - python3, make, g++: Werden zum Kompilieren von node-pty (für pi-web) benötigt
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Pi CLI und die Weboberfläche @jmfederico/pi-web global installieren
RUN npm install -g @earendil-works/pi-coding-agent @jmfederico/pi-web --allow-scripts=node-pty

# Build-Tools nach der Installation wieder entfernen, um das Image schlank zu halten
RUN apt-get purge -y --auto-remove python3 make g++

# Aus Sicherheitsgründen auf den nicht-privilegierten User "node" wechseln
USER node
WORKDIR /workspace

# Konfigurations- und Arbeitsverzeichnisse mit korrekten Rechten vorbereiten
RUN mkdir -p /home/node/.pi/agent /home/node/.pi-web

# Standard-Port von pi-web
EXPOSE 8504

# PI WEBs lifecycle CLI uses the host's systemd/launchd service manager. In the
# container, start its foreground services directly instead.
ENV PI_WEB_HOST=0.0.0.0 \
    PI_WEB_PORT=8504
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

CMD ["/usr/local/bin/docker-entrypoint.sh"]
