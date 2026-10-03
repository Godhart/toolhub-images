# Docker / Podman; build context = this directory.
# Five targets: base (default), git, docs, hdl, okf.
ARG NODE_IMAGE=node:22-bookworm-slim
ARG BUN_IMAGE=oven/bun:1.4.2
FROM ${BUN_IMAGE} AS bun-binary
FROM ${NODE_IMAGE} AS common
USER root
COPY --from=bun-binary /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx \
 && apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip ca-certificates openssl tini \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:/opt/tool-runtime/node_modules/.bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 NODE_ENV=production \
    DATABASE_URL=file:/data/hub.db PORT=3000 \
    HOME=/tmp/home XDG_CACHE_HOME=/tmp/cache \
    NODE_PATH=/opt/tool-runtime/node_modules

# ---- Python: core + filesystem toolpack dependencies ----
COPY config/python-base.txt /opt/config/python-base.txt
RUN pip install --no-cache-dir -r /opt/config/python-base.txt
# ---- EXTRA PYTHON PACKAGES: edit config/python-extra.txt ----
COPY config/python-extra.txt /opt/config/python-extra.txt
RUN pip install --no-cache-dir -r /opt/config/python-extra.txt

# ---- Node / TypeScript / TWYLT (the local, unpublished implementation) ----
COPY vendor/twylt-typescript /opt/twylt-typescript
RUN cd /opt/twylt-typescript && npm ci --include=dev && npm test
COPY config/node-base.json /opt/tool-runtime/package.json
# ---- EXTRA NODE PACKAGES: edit dependencies in config/node-extra.json ----
COPY config/node-extra.json /opt/config/node-extra.json
RUN node -e 'const fs=require("fs"); const p="/opt/tool-runtime/package.json"; const j=JSON.parse(fs.readFileSync(p)); Object.assign(j.dependencies,JSON.parse(fs.readFileSync("/opt/config/node-extra.json")).dependencies); fs.writeFileSync(p,JSON.stringify(j));' \
 && cd /opt/tool-runtime && npm install --omit=dev \
 && ln -s /opt/tool-runtime/node_modules /node_modules \
 && node --input-type=module -e 'import("@twylt/core")'

# ---- ToolHub, pinned source snapshot; no tool source copied into /tools ----
COPY vendor/toolhub /opt/toolhub
WORKDIR /opt/toolhub
RUN NODE_ENV=development bun install --frozen-lockfile \
 && bun run db:generate \
 && bun run build:admin
COPY scripts/container-init.ts /opt/toolhub/container-init.ts
COPY scripts/entrypoint.sh /usr/local/bin/container-entrypoint
RUN chmod 755 /usr/local/bin/container-entrypoint \
 && mkdir -p /data /tools /workspace \
 && chown 1000:1000 /data /tools /workspace \
 && pip check
EXPOSE 3000
WORKDIR /workspace
USER 1000:1000
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/container-entrypoint"]
CMD ["toolhub"]

# ---- Extended: Git over HTTPS and SSH ----
FROM common AS git
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client \
 && rm -rf /var/lib/apt/lists/*
USER 1000:1000

# ---- Extended: documentation (includes Git) ----
FROM git AS docs
USER root
ARG WITH_LATEX=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    pandoc graphviz doxygen fonts-dejavu-core fonts-noto-core \
 && if [ "$WITH_LATEX" = 1 ]; then apt-get install -y --no-install-recommends \
    texlive-xetex texlive-latex-extra texlive-lang-cyrillic; fi \
 && rm -rf /var/lib/apt/lists/*
COPY config/python-docs.txt /opt/config/python-docs.txt
RUN pip install --no-cache-dir -r /opt/config/python-docs.txt && pip check \
 && cd /opt/tool-runtime && npm install typedoc@0.28.13 markdownlint-cli2@0.18.1
USER 1000:1000

# ---- Extended: hdl-order 0.7.0 + TWYLT wrappers' backend (includes Git) ----
FROM git AS hdl
USER root
COPY vendor/hdl-order /opt/hdl-order-source
RUN apt-get update && apt-get install -y --no-install-recommends graphviz \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir '/opt/hdl-order-source[twylt]' \
 && pip check && hdl-order --help \
 && rm -rf /opt/hdl-order-source
USER 1000:1000

# ---- Extended: OKF documentation workspace (includes docs + Git) ----
FROM docs AS okf
USER root
COPY vendor/okf-workspace /opt/okf-workspace
RUN cd /opt/okf-workspace && npm ci --include=dev && npm run build \
 && npm prune --omit=dev \
 && chmod 755 dist/cli.js \
 && ln -s /opt/okf-workspace/dist/cli.js /usr/local/bin/okf-workspace \
 && okf-workspace --version \
 && mkdir -p /okf-state && chown 1000:1000 /okf-state
ENV OKF_WORKSPACE_STATE=/okf-state
USER 1000:1000

# Default build stays the small base variant.
FROM common AS base
