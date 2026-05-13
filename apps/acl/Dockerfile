FROM denoland/deno:2.7.5

WORKDIR /app

COPY deno.json deno.lock ./
COPY apps/acl ./apps/acl
COPY packages/shared-auth ./packages/shared-auth
COPY packages/shared-types ./packages/shared-types

RUN deno cache apps/acl/src/main.ts

ENV PORT=8080
EXPOSE 8080

CMD ["run", "--allow-net", "--allow-env", "apps/acl/src/main.ts"]
