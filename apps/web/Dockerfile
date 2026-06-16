FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm install
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Next.js standalone server binds to $HOSTNAME; Docker sets HOSTNAME to the
# container id, so pin it to 0.0.0.0 to listen on all interfaces.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Prisma: schema + migrations are needed for `migrate deploy` at boot. The
# standalone trace only ships @prisma/client; the prisma CLI used at boot pulls
# in further transitive deps (e.g. `effect`), so overlay the full build
# node_modules (a superset of the traced one) to guarantee the CLI runs.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=10 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
# Regenerate the Prisma client at start so it always matches the shipped schema.
# (Build-stage `prisma generate` can be served from a stale Docker layer when the
# lockfile is unchanged, leaving the client missing newly-added models.) Then
# apply migrations and start the server.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js generate && node node_modules/prisma/build/index.js migrate deploy && node server.js"]
