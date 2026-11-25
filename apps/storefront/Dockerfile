FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/storefront/package.json apps/storefront/package.json
RUN npm ci --include=dev

COPY apps/storefront apps/storefront

EXPOSE 8000
CMD ["npm", "run", "dev", "--workspace=@b2c/storefront"]
