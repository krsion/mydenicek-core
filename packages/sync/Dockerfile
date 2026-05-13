FROM denoland/deno:2.7.5

WORKDIR /app

COPY deno.json deno.lock ./
COPY apps/sync-server ./apps/sync-server
COPY packages/core ./packages/core
COPY packages/sync ./packages/sync
COPY packages/shared-auth ./packages/shared-auth

RUN deno cache apps/sync-server/main.ts

ENV PORT=8787
ENV HOSTNAME=0.0.0.0
ENV AUTH_ENABLED=false

EXPOSE 8787

CMD ["run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "apps/sync-server/main.ts"]
