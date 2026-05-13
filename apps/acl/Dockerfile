FROM denoland/deno:2.3.3
WORKDIR /app
COPY deno.json .
COPY main.ts .
RUN deno install --entrypoint main.ts
EXPOSE 3002
CMD ["deno", "run", "--allow-net", "--allow-env", "main.ts"]
