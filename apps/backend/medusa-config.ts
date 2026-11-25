import { defineConfig, loadEnv, MedusaError } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

const redisModules = process.env.REDIS_URL
  ? [
      {
        resolve: "@medusajs/medusa/caching",
        options: {
          providers: [
            {
              resolve: "@medusajs/medusa/caching-redis",
              id: "caching-redis",
              is_default: true,
              options: { redisUrl: process.env.REDIS_URL },
            },
          ],
        },
      },
      {
        resolve: "@medusajs/medusa/event-bus-redis",
        options: { redisUrl: process.env.REDIS_URL },
      },
      {
        resolve: "@medusajs/medusa/workflow-engine-redis",
        options: {
          redis: { redisUrl: process.env.REDIS_URL },
        },
      },
      {
        resolve: "@medusajs/medusa/locking",
        options: {
          providers: [
            {
              resolve: "@medusajs/medusa/locking-redis",
              id: "locking-redis",
              is_default: true,
              options: { redisUrl: process.env.REDIS_URL },
            },
          ],
        },
      },
    ]
  : []

const resendApiKey = process.env.RESEND_API_KEY?.trim()
const resendFromEmail = process.env.RESEND_FROM_EMAIL?.trim()
const resendConfigured = Boolean(resendApiKey && resendFromEmail)
const resendPartiallyConfigured = Boolean(resendApiKey || resendFromEmail)

if (resendPartiallyConfigured && !resendConfigured) {
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "RESEND_API_KEY and RESEND_FROM_EMAIL must be configured together"
  )
}

const notificationProviders = [
  {
    resolve: "@medusajs/medusa/notification-local",
    id: "local-feed",
    options: {
      name: "Local Feed Notification Provider",
      channels: ["feed"],
    },
  },
  resendConfigured
    ? {
        resolve: "./src/modules/resend",
        id: "resend",
        options: {
          channels: ["email"],
          api_key: resendApiKey,
          from: resendFromEmail,
        },
      }
    : {
        resolve: "@medusajs/medusa/notification-local",
        id: "local-email",
        options: {
          name: "Local Email Notification Provider",
          channels: ["email"],
        },
      },
]

const notificationModules = [
  {
    resolve: "@medusajs/medusa/notification",
    options: {
      providers: notificationProviders,
    },
  },
]

const r2Endpoint = process.env.R2_ENDPOINT?.trim()
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID?.trim()
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim()
const r2FileBucket = process.env.R2_FILE_BUCKET?.trim()
const r2Configured = Boolean(
  r2Endpoint && r2AccessKeyId && r2SecretAccessKey && r2FileBucket
)
const r2PartiallyConfigured = Boolean(
  r2Endpoint || r2AccessKeyId || r2SecretAccessKey || r2FileBucket
)

if (r2PartiallyConfigured && !r2Configured) {
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_FILE_BUCKET must be configured together"
  )
}

const fileModules = r2Configured
  ? [
      {
        resolve: "@medusajs/medusa/file",
        options: {
          providers: [
            {
              resolve: "@medusajs/medusa/file-s3",
              id: "s3",
              options: {
                file_url:
                  process.env.R2_FILE_URL?.trim() ||
                  `${r2Endpoint?.replace(/\/$/, "")}/${r2FileBucket}`,
                access_key_id: r2AccessKeyId,
                secret_access_key: r2SecretAccessKey,
                region: process.env.R2_REGION?.trim() || "auto",
                bucket: r2FileBucket,
                endpoint: r2Endpoint,
                acl: false,
              },
            },
          ],
        },
      },
    ]
  : []

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    cookieOptions:
      process.env.LOCAL_HTTP_ADMIN === "true"
        ? { secure: false, sameSite: "lax" }
        : undefined,
    http: {
      storeCors: process.env.STORE_CORS || "http://localhost:8000",
      adminCors: process.env.ADMIN_CORS || "http://localhost:9000",
      authCors: process.env.AUTH_CORS || "http://localhost:9000",
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  },
  modules: [...redisModules, ...notificationModules, ...fileModules],
})
