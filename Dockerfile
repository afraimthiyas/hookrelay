FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
