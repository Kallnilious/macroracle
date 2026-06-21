# Sandbox image for the macroracle project.
# Runs Claude Code (--dangerously-skip-permissions) isolated, with the full
# Node + Postgres toolchain the app needs, as the non-root `node` user.
FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates less ripgrep nano unzip curl \
        postgresql postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Postgres server binaries on PATH so non-root `node` can run its own cluster.
# Debian bookworm ships PostgreSQL 15.
ENV PATH="/usr/lib/postgresql/15/bin:${PATH}"

RUN npm install -g @anthropic-ai/claude-code

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER node
WORKDIR /workspace/macroracle

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["bash"]
