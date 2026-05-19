FROM node:26-trixie-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:26-trixie-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV TZ=Africa/Luanda
ENV UJIMU_DATA_DIR=/home/ujimu/.local/share/ujimu
ENV UJIMU_PI_AGENT_DIR=/app/config/ujimu-pi-agent

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates coreutils \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @google/gemini-cli \
  && groupadd --system ujimu \
  && useradd --system --gid ujimu --home-dir /home/ujimu --create-home --shell /usr/sbin/nologin ujimu \
  && mkdir -p /home/ujimu/.pi /home/ujimu/.local/share/ujimu /app/config \
  && chown -R ujimu:ujimu /home/ujimu /app

WORKDIR /app

COPY --from=build --chown=ujimu:ujimu /app/.output ./.output
COPY --from=build --chown=ujimu:ujimu /app/config ./config

USER ujimu

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
