FROM node:26-bookworm-slim

# Plugin metadata is the source of truth for Pi packages and PI WEB plugins.
COPY plugins.json /etc/pi-agent/plugins.json
COPY --chmod=755 scripts/manage-plugins.js /usr/local/bin/pi-agent-plugins
COPY --chmod=755 scripts/merge-settings.js /usr/local/bin/merge-pi-settings

# Systemabhängigkeiten installieren:
# - git, curl, ca-certificates: Standard-Tools für Pi und MCP
# - make, g++: Werden zum Kompilieren von node-pty (für pi-web) benötigt
# - system packages: werden aus plugins.json gelesen
RUN plugin_system_packages="$(/usr/local/bin/pi-agent-plugins system-packages)" \
    && apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates make g++ $plugin_system_packages \
    && rm -rf /var/lib/apt/lists/*

# Pi CLI und die Weboberfläche @jmfederico/pi-web global installieren.
RUN npm install -g @earendil-works/pi-coding-agent @jmfederico/pi-web --allow-scripts=node-pty

# Install globally-scoped PI WEB plugins while the image build still runs as root.
RUN /usr/local/bin/pi-agent-plugins install-web-dependencies

# Aus Sicherheitsgründen auf den nicht-privilegierten User "node" wechseln
USER node
WORKDIR /workspace

# Install configured Pi packages, configure PI WEB plugins, and generate its
# defaults from the same plugin manifest used by the Kubernetes bootstrap.
RUN mkdir -p /home/node/.pi/agent /home/node/.pi-web/plugins \
    && pi-agent-plugins install

# Build tools are needed for native npm/Python packages during installation;
# keep Python itself for configured plugins at runtime.
USER root
RUN apt-get purge -y --auto-remove make g++ \
    && rm -rf /var/lib/apt/lists/*
USER node

# Standard-Port von pi-web
EXPOSE 8504

# PI WEBs lifecycle CLI uses the host's systemd/launchd service manager. In the
# container, start its foreground services directly instead.
ENV PI_WEB_HOST=0.0.0.0 \
    PI_WEB_PORT=8504 \
    PI_WEB_DEFAULTS_CONFIG=/home/node/.pi-web/defaults.json
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

CMD ["/usr/local/bin/docker-entrypoint.sh"]
