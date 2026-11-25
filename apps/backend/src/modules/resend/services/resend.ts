import {
  Logger,
  NotificationTypes,
} from "@medusajs/framework/types"
import {
  AbstractNotificationProviderService,
  MedusaError,
} from "@medusajs/framework/utils"

type InjectedDependencies = {
  logger: Logger
}

export type ResendNotificationServiceOptions = {
  api_key?: unknown
  from?: unknown
  channels?: string[]
  max_retries?: unknown
  retry_delay_ms?: unknown
  api_url?: unknown
}

type ResendServiceConfig = {
  apiKey: string
  from: string
  maxRetries: number
  retryDelayMs: number
  apiUrl: string
}

type ResendEmailPayload = {
  from: string
  to: string[]
  subject?: string
  html?: string
  text?: string
  template?: {
    id: string
    variables?: Record<string, unknown>
  }
  attachments?: Array<{
    filename: string
    content: string
  }>
  cc?: string | string[]
  bcc?: string | string[]
  reply_to?: string | string[]
  headers?: Record<string, string>
  tags?: Array<{ name: string; value: string }>
  scheduled_at?: string
}

type ResendResponseBody = {
  id?: unknown
  name?: unknown
  message?: unknown
  error?: {
    name?: unknown
    message?: unknown
  }
}

const DEFAULT_API_URL = "https://api.resend.com/emails"
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 250
const MAX_RETRY_DELAY_MS = 30_000

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function getString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value.trim() : undefined
}

function throwInvalidData(message: string): never {
  throw new MedusaError(MedusaError.Types.INVALID_DATA, message)
}

function getStringOrStringArray(
  value: unknown
): string | string[] | undefined {
  if (typeof value === "string") {
    return value
  }

  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  ) {
    return value
  }

  return undefined
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status) || status >= 500
}

function getResponseMessage(
  body: ResendResponseBody | string | undefined,
  response: Response
): string {
  if (typeof body === "string" && body.trim()) {
    return body.trim()
  }

  if (body && typeof body === "object") {
    const nestedMessage = body.error?.message
    if (typeof nestedMessage === "string" && nestedMessage.trim()) {
      return nestedMessage.trim()
    }

    if (typeof body.message === "string" && body.message.trim()) {
      return body.message.trim()
    }

    if (typeof body.name === "string" && body.name.trim()) {
      return body.name.trim()
    }
  }

  return response.statusText || "Unknown Resend API error"
}

async function readResponseBody(
  response: Response
): Promise<ResendResponseBody | string | undefined> {
  if (typeof response.text === "function") {
    const text = await response.text()
    if (!text) {
      return undefined
    }

    try {
      return JSON.parse(text) as ResendResponseBody
    } catch {
      return text
    }
  }

  const responseWithJson = response as Response & {
    json?: () => Promise<unknown>
  }
  if (typeof responseWithJson.json === "function") {
    const body = await responseWithJson.json()
    return typeof body === "string"
      ? body
      : (body as ResendResponseBody | undefined)
  }

  return undefined
}

function getRetryAfterMs(response: Response): number | undefined {
  const headers = response.headers as unknown
  let retryAfter: string | null | undefined

  if (
    headers &&
    typeof headers === "object" &&
    "get" in headers &&
    typeof headers.get === "function"
  ) {
    retryAfter = headers.get("retry-after")
  } else if (headers && typeof headers === "object") {
    const headersRecord = headers as Record<string, unknown>
    const value = headersRecord["retry-after"] ?? headersRecord["Retry-After"]
    retryAfter = typeof value === "string" ? value : undefined
  }

  if (!retryAfter) {
    return undefined
  }

  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000
  }

  const date = Date.parse(retryAfter)
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now())
  }

  return undefined
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return String(error)
}

export class ResendNotificationService extends AbstractNotificationProviderService {
  static identifier = "notification-resend"

  protected logger_: Logger
  protected config_: ResendServiceConfig

  constructor(
    { logger }: InjectedDependencies,
    options: ResendNotificationServiceOptions = {}
  ) {
    super()

    ResendNotificationService.validateOptions(options)
    this.logger_ = logger
    this.config_ = {
      apiKey: String(options.api_key).trim(),
      from: String(options.from).trim(),
      maxRetries: isNonNegativeInteger(options.max_retries)
        ? options.max_retries
        : DEFAULT_MAX_RETRIES,
      retryDelayMs: isNonNegativeInteger(options.retry_delay_ms)
        ? options.retry_delay_ms
        : DEFAULT_RETRY_DELAY_MS,
      apiUrl: isNonEmptyString(options.api_url)
        ? options.api_url.trim()
        : DEFAULT_API_URL,
    }
  }

  static validateOptions(options: Record<string, unknown> = {}): void {
    if (!isRecord(options)) {
      throwInvalidData("Resend provider options must be an object.")
    }

    if (!isNonEmptyString(options.api_key)) {
      throwInvalidData(
        "Resend API key is required in the provider's options."
      )
    }

    if (!isNonEmptyString(options.from)) {
      throwInvalidData(
        "Resend sender address is required in the provider's options."
      )
    }

    if (
      options.max_retries !== undefined &&
      !isNonNegativeInteger(options.max_retries)
    ) {
      throwInvalidData("Resend max_retries must be a non-negative integer.")
    }

    if (
      options.retry_delay_ms !== undefined &&
      !isNonNegativeInteger(options.retry_delay_ms)
    ) {
      throwInvalidData(
        "Resend retry_delay_ms must be a non-negative integer."
      )
    }

    if (options.api_url !== undefined) {
      if (!isNonEmptyString(options.api_url)) {
        throwInvalidData("Resend api_url must be a valid HTTP(S) URL.")
      }

      let validUrl = false
      try {
        const url = new URL(options.api_url.trim())
        validUrl = url.protocol === "http:" || url.protocol === "https:"
      } catch {
        validUrl = false
      }

      if (!validUrl) {
        throwInvalidData("Resend api_url must be a valid HTTP(S) URL.")
      }
    }
  }

  async send(
    notification: NotificationTypes.ProviderSendNotificationDTO
  ): Promise<NotificationTypes.ProviderSendNotificationResultsDTO> {
    const payload = this.buildPayload(notification)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config_.apiKey}`,
      "Content-Type": "application/json",
    }

    const providerData = notification.provider_data
    const runtimeNotification = notification as NotificationTypes.ProviderSendNotificationDTO & {
      idempotency_key?: unknown
      idempotencyKey?: unknown
    }
    const idempotencyKey = getString(
      runtimeNotification.idempotency_key ??
        runtimeNotification.idempotencyKey ??
        providerData?.idempotency_key ??
        providerData?.idempotencyKey
    )
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey
    }

    for (let attempt = 0; attempt <= this.config_.maxRetries; attempt += 1) {
      try {
        const response = await fetch(this.config_.apiUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        })
        const responseBody = await readResponseBody(response)
        const responseOk =
          response.ok ?? (response.status >= 200 && response.status < 300)

        if (responseOk) {
          const id =
            responseBody &&
            typeof responseBody === "object" &&
            typeof responseBody.id === "string"
              ? responseBody.id
              : undefined

          return id ? { id } : {}
        }

        const message = `Resend rejected email (${response.status}): ${getResponseMessage(
          responseBody,
          response
        )}`

        if (
          !isRetryableStatus(response.status) ||
          attempt >= this.config_.maxRetries
        ) {
          throw new MedusaError(
            MedusaError.Types.UNEXPECTED_STATE,
            `Failed to send email with Resend: ${message}`
          )
        }

        await this.waitBeforeRetry(response, attempt, message)
      } catch (error) {
        if (error instanceof MedusaError) {
          throw error
        }

        if (attempt >= this.config_.maxRetries) {
          throw new MedusaError(
            MedusaError.Types.UNEXPECTED_STATE,
            `Failed to send email with Resend: Failed to reach Resend: ${getErrorMessage(
              error
            )}`
          )
        }

        await this.waitBeforeRetry(
          undefined,
          attempt,
          `Failed to reach Resend: ${getErrorMessage(error)}`
        )
      }
    }

    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Failed to send email with Resend: request did not complete."
    )
  }

  protected buildPayload(
    notification: NotificationTypes.ProviderSendNotificationDTO
  ): ResendEmailPayload {
    if (!isRecord(notification)) {
      return throwInvalidData("No notification information provided.")
    }

    const to = getString(notification.to)
    if (!to) {
      return throwInvalidData(
        "A recipient is required to send a Resend email."
      )
    }

    if (
      notification.from !== undefined &&
      notification.from !== null &&
      typeof notification.from !== "string"
    ) {
      return throwInvalidData("The Resend sender address must be a string.")
    }

    const from = getString(notification.from) || this.config_.from
    if (!from) {
      return throwInvalidData("A sender is required to send a Resend email.")
    }

    const payload: ResendEmailPayload = {
      from,
      to: [to],
    }

    const hasContent =
      notification.content !== undefined && notification.content !== null

    if (hasContent) {
      if (!isRecord(notification.content)) {
        return throwInvalidData("Resend notification content must be an object.")
      }

      const { html, subject, text } = notification.content
      if (
        (html !== undefined && typeof html !== "string") ||
        (text !== undefined && typeof text !== "string")
      ) {
        return throwInvalidData(
          "Resend notification html and text content must be strings."
        )
      }

      if (!html && !text) {
        return throwInvalidData(
          "Resend notification content must include html or text."
        )
      }

      const resolvedSubject = getString(subject)
      if (!resolvedSubject) {
        return throwInvalidData(
          "A subject is required when sending Resend email content."
        )
      }

      payload.subject = resolvedSubject
      if (html) {
        payload.html = html
      }
      if (text) {
        payload.text = text
      }
    } else {
      const template = getString(notification.template)
      if (!template) {
        return throwInvalidData(
          "A Resend template ID or email content is required."
        )
      }

      if (
        notification.data !== undefined &&
        notification.data !== null &&
        !isRecord(notification.data)
      ) {
        return throwInvalidData(
          "Resend template data must be an object when provided."
        )
      }

      payload.template = {
        id: template,
        variables: notification.data ?? {},
      }
    }

    if (
      notification.attachments !== undefined &&
      notification.attachments !== null
    ) {
      if (!Array.isArray(notification.attachments)) {
        return throwInvalidData("Resend attachments must be an array.")
      }

      if (notification.attachments.length) {
        payload.attachments = notification.attachments.map(
          (attachment, index) => {
            if (
              !isRecord(attachment) ||
              !isNonEmptyString(attachment.filename) ||
              typeof attachment.content !== "string"
            ) {
              return throwInvalidData(
                `Resend attachment at index ${index} must include a filename and string content.`
              )
            }

            return {
              filename: attachment.filename,
              content: attachment.content,
            }
          }
        )
      }
    }

    if (
      notification.provider_data !== undefined &&
      notification.provider_data !== null &&
      !isRecord(notification.provider_data)
    ) {
      return throwInvalidData("Resend provider_data must be an object.")
    }

    this.copyProviderData(payload, notification.provider_data)

    return payload
  }

  protected copyProviderData(
    payload: ResendEmailPayload,
    providerData?: Record<string, unknown> | null
  ): void {
    if (!providerData) {
      return
    }

    const cc = getStringOrStringArray(providerData.cc)
    const bcc = getStringOrStringArray(providerData.bcc)
    const replyTo = getStringOrStringArray(
      providerData.reply_to ?? providerData.replyTo
    )

    if (cc) {
      payload.cc = cc
    }
    if (bcc) {
      payload.bcc = bcc
    }
    if (replyTo) {
      payload.reply_to = replyTo
    }

    if (
      providerData.headers &&
      typeof providerData.headers === "object" &&
      !Array.isArray(providerData.headers)
    ) {
      const headers = Object.entries(providerData.headers).filter(
        ([, value]) => typeof value === "string"
      )
      if (headers.length) {
        payload.headers = Object.fromEntries(headers) as Record<string, string>
      }
    }

    if (Array.isArray(providerData.tags)) {
      const tags = providerData.tags.filter(
        (tag): tag is { name: string; value: string } =>
          !!tag &&
          typeof tag === "object" &&
          typeof tag.name === "string" &&
          typeof tag.value === "string"
      )
      if (tags.length) {
        payload.tags = tags
      }
    }

    const scheduledAt = getString(
      providerData.scheduled_at ?? providerData.scheduledAt
    )
    if (scheduledAt) {
      payload.scheduled_at = scheduledAt
    }
  }

  protected async waitBeforeRetry(
    response: Response | undefined,
    attempt: number,
    message: string
  ): Promise<void> {
    const exponentialDelay = Math.min(
      this.config_.retryDelayMs * 2 ** attempt,
      MAX_RETRY_DELAY_MS
    )
    const retryAfter = response ? getRetryAfterMs(response) : undefined
    const delay = Math.min(retryAfter ?? exponentialDelay, MAX_RETRY_DELAY_MS)

    this.logger_?.warn?.(
      `Resend email request failed (attempt ${attempt + 1}/${
        this.config_.maxRetries + 1
      }): ${message}. Retrying in ${delay}ms.`
    )

    if (delay > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay))
    }
  }
}
