import type { Logger, NotificationTypes } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import provider, { ResendNotificationService } from ".."

const logger = {
  warn: jest.fn(),
} as unknown as Logger

const notification: NotificationTypes.ProviderSendNotificationDTO = {
  to: "customer@example.com",
  channel: "email",
  template: "order-confirmed",
  data: { order_id: "order_123" },
}

function createProvider(
  options: Record<string, unknown> = {
    api_key: "re_test_key",
    from: "Store <orders@example.com>",
  }
): ResendNotificationService {
  return new ResendNotificationService({ logger }, options)
}

describe("ResendNotificationService", () => {
  let fetchMock: jest.Spied<typeof fetch>

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    fetchMock.mockRestore()
    jest.clearAllMocks()
  })

  it("registers as a notification module provider", () => {
    expect(provider).toMatchObject({
      module: Modules.NOTIFICATION,
      services: [ResendNotificationService],
    })
  })

  it("validates required provider options", () => {
    expect(() =>
      ResendNotificationService.validateOptions({
        from: "orders@example.com",
      })
    ).toThrow("Resend API key is required")

    expect(() =>
      ResendNotificationService.validateOptions({
        api_key: "re_test_key",
      })
    ).toThrow("Resend sender address is required")

    expect(() =>
      ResendNotificationService.validateOptions({
        api_key: "re_test_key",
        from: "orders@example.com",
        max_retries: -1,
      })
    ).toThrow("max_retries must be a non-negative integer")

    expect(() =>
      ResendNotificationService.validateOptions({
        api_key: "re_test_key",
        from: "orders@example.com",
        api_url: "not-a-url",
      })
    ).toThrow("api_url must be a valid HTTP(S) URL")
  })

  it("sends HTML and text content with the notification recipient", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "email_123" }), { status: 200 })
    )

    const result = await createProvider().send({
      ...notification,
      from: "Checkout <checkout@example.com>",
      content: {
        subject: "Your order is confirmed",
        html: "<p>Thanks for your order.</p>",
        text: "Thanks for your order.",
      },
      attachments: [
        {
          filename: "receipt.pdf",
          content: "base64-receipt",
          content_type: "application/pdf",
        },
      ],
      provider_data: {
        cc: "support@example.com",
        reply_to: ["support@example.com"],
        headers: { "X-Order-ID": "order_123" },
        tags: [{ name: "type", value: "order-confirmed" }],
        idempotency_key: "notification_123",
      },
    })

    expect(result).toEqual({ id: "email_123" })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.resend.com/emails")
    expect(request?.method).toBe("POST")
    expect(request?.headers).toEqual({
      Authorization: "Bearer re_test_key",
      "Content-Type": "application/json",
      "Idempotency-Key": "notification_123",
    })
    expect(JSON.parse(String(request?.body))).toEqual({
      from: "Checkout <checkout@example.com>",
      to: ["customer@example.com"],
      subject: "Your order is confirmed",
      html: "<p>Thanks for your order.</p>",
      text: "Thanks for your order.",
      attachments: [
        {
          filename: "receipt.pdf",
          content: "base64-receipt",
        },
      ],
      cc: "support@example.com",
      reply_to: ["support@example.com"],
      headers: { "X-Order-ID": "order_123" },
      tags: [{ name: "type", value: "order-confirmed" }],
    })
  })

  it("forwards the Medusa notification idempotency key", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "email_idempotent" }), { status: 200 })
    )

    await createProvider().send({
      ...notification,
      idempotency_key: "notification_runtime_123",
    } as NotificationTypes.ProviderSendNotificationDTO & {
      idempotency_key: string
    })

    const request = fetchMock.mock.calls[0][1]
    expect(request?.headers).toMatchObject({
      "Idempotency-Key": "notification_runtime_123",
    })
  })

  it("sends the notification template and data when content is not provided", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "email_template_123" }), { status: 200 })
    )

    await createProvider().send(notification)

    const request = fetchMock.mock.calls[0][1]
    expect(JSON.parse(String(request?.body))).toEqual({
      from: "Store <orders@example.com>",
      to: ["customer@example.com"],
      template: {
        id: "order-confirmed",
        variables: { order_id: "order_123" },
      },
    })
  })

  it("rejects content without a subject instead of using the template as one", async () => {
    await expect(
      createProvider().send({
        ...notification,
        content: { html: "<p>Missing subject</p>" },
      })
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: expect.stringContaining("subject is required"),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not retry a non-transient Resend API error", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          name: "validation_error",
          message: "The sender address is not verified",
        }),
        { status: 400, statusText: "Bad Request" }
      )
    )

    await expect(createProvider().send(notification)).rejects.toMatchObject({
      type: MedusaError.Types.UNEXPECTED_STATE,
      message: expect.stringContaining(
        "The sender address is not verified"
      ),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it("retries transient API failures before succeeding", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "try again" }), {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "retry-after": "0" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "email_after_retry" }), {
          status: 200,
        })
      )

    const result = await createProvider({
      api_key: "re_test_key",
      from: "orders@example.com",
      max_retries: 1,
      retry_delay_ms: 0,
    }).send(notification)

    expect(result).toEqual({ id: "email_after_retry" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Retrying in 0ms")
    )
  })

  it("retries network failures and returns a Medusa error after exhausting retries", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("socket closed"))
      .mockRejectedValueOnce(new Error("socket still closed"))

    await expect(
      createProvider({
        api_key: "re_test_key",
        from: "orders@example.com",
        max_retries: 1,
        retry_delay_ms: 0,
      }).send(notification)
    ).rejects.toMatchObject({
      type: MedusaError.Types.UNEXPECTED_STATE,
      message: expect.stringContaining("socket still closed"),
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it("rejects a notification without content or a template", async () => {
    await expect(
      createProvider().send({
        ...notification,
        template: "",
        content: null,
      })
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: expect.stringContaining("template ID or email content"),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects malformed notification fields before making a request", async () => {
    await expect(
      createProvider().send({
        ...notification,
        to: 42,
      } as unknown as NotificationTypes.ProviderSendNotificationDTO)
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: expect.stringContaining("recipient is required"),
    })

    await expect(
      createProvider().send({
        ...notification,
        attachments: [{ filename: "receipt.pdf", content: 42 }],
      } as unknown as NotificationTypes.ProviderSendNotificationDTO)
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: expect.stringContaining("attachment at index 0"),
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
