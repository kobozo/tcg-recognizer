FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build
FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
