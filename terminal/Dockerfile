# ODP Terminal container. Build from the repository root:
#   docker build -f terminal/Dockerfile -t odp-terminal .
#   docker run -p 6901:6901 -e TERMINAL_TOKEN=change-me -v odp-data:/data odp-terminal

FROM node:22-slim AS ui
WORKDIR /ui
COPY terminal/frontend/package.json terminal/frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY terminal/frontend/ ./
RUN npx tsc --noEmit -p . && npx vite build --outDir /ui/dist

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY openbb_platform/core openbb_platform/core
COPY openbb_platform/extensions openbb_platform/extensions
COPY openbb_platform/providers openbb_platform/providers
COPY terminal/backend terminal/backend
COPY terminal/install.sh terminal/install.sh
RUN ./terminal/install.sh
COPY --from=ui /ui/dist terminal/backend/odp_terminal/static
# Build OpenBB's static package once at image build time instead of on first start.
RUN python -c "from openbb import obb; print('openbb ready')"
ENV TERMINAL_HOST=0.0.0.0 TERMINAL_PORT=6901 TERMINAL_DB=/data/terminal.db
VOLUME /data
EXPOSE 6901
CMD ["odp-terminal"]
