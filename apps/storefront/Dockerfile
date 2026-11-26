FROM node:24-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/storefront/package.json apps/storefront/package.json
RUN npm ci --include=dev

# Local development target used by infra/local/compose.yaml.
FROM deps AS development

COPY apps/storefront apps/storefront

EXPOSE 8000
CMD ["npm", "run", "dev", "--workspace=@b2c/storefront"]

# Production build. Catalog and cart routes read runtime configuration, so no
# secret or environment-specific value is required at build time.
FROM deps AS build

COPY apps/storefront apps/storefront
RUN npm run build --workspace=@b2c/storefront

FROM node:24-alpine AS production

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/backend/package.json apps/backend/package.json
COPY --from=build /app/apps/storefront/package.json apps/storefront/package.json
COPY --from=build /app/apps/storefront/next.config.ts apps/storefront/next.config.ts
COPY --from=build /app/apps/storefront/.next apps/storefront/.next
COPY --from=build /app/node_modules node_modules

RUN chown -R node:node /app/apps/storefront/.next
USER node

EXPOSE 8000
CMD ["npm", "run", "start", "--workspace=@b2c/storefront"]
