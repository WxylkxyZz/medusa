FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/storefront/package.json apps/storefront/package.json
RUN npm ci --include=dev

COPY apps/backend apps/backend
RUN npm run build --workspace=@b2c/backend

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/backend/package.json apps/backend/package.json
COPY --from=build /app/apps/backend/medusa-config.ts apps/backend/medusa-config.ts
COPY --from=build /app/apps/backend/tsconfig.json apps/backend/tsconfig.json
COPY --from=build /app/apps/backend/src apps/backend/src
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/backend/.medusa/server apps/backend/.medusa/server
COPY --from=build /app/apps/backend/public apps/backend/public

RUN addgroup -S medusa && adduser -S medusa -G medusa \
  && chown -R medusa:medusa /app
USER medusa

CMD ["npm", "run", "start", "--workspace=@b2c/backend"]
