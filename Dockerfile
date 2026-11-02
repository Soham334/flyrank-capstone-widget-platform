FROM node:24.11.0-alpine
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node public ./public
COPY --chown=node:node demo ./demo
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node test ./test
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=4100 DATABASE_PATH=/app/data/relay.sqlite
EXPOSE 4100
CMD ["node", "src/server.js"]
