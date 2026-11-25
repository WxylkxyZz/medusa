import type { SubscriberArgs } from "@medusajs/framework/subscribers"
import {
  AuthWorkflowEvents,
  ContainerRegistrationKeys,
  Modules,
  OrderWorkflowEvents,
} from "@medusajs/framework/utils"
import orderNotifications from "../order-notifications"

type TestContainer = SubscriberArgs["container"]

type TestDependencies = {
  container: TestContainer
  query: { graph: jest.Mock }
  notificationService: { createNotifications: jest.Mock }
  logger: { warn: jest.Mock; error: jest.Mock }
}

function createDependencies(order: Record<string, unknown>): TestDependencies {
  const query = {
    graph: jest.fn().mockResolvedValue({ data: [order] }),
  }
  const notificationService = {
    createNotifications: jest.fn().mockResolvedValue([]),
  }
  const logger = {
    warn: jest.fn(),
    error: jest.fn(),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) {
        return query
      }
      if (key === Modules.NOTIFICATION) {
        return notificationService
      }
      if (key === ContainerRegistrationKeys.LOGGER) {
        return logger
      }
      throw new Error(`Unexpected container key: ${key}`)
    }),
  } as unknown as TestContainer

  return { container, query, notificationService, logger }
}

describe("order notifications subscriber", () => {
  it("queues an idempotent order confirmation with rendered content", async () => {
    const dependencies = createDependencies({
      id: "order_123",
      display_id: 42,
      email: "customer@example.com",
      customer_id: "cus_123",
      currency_code: "usd",
      total: 25,
      items: [{ title: "T-shirt", quantity: 1 }],
    })

    await orderNotifications({
      event: {
        name: OrderWorkflowEvents.PLACED,
        data: { id: "order_123" },
      },
      container: dependencies.container,
      pluginOptions: {},
    } as never)

    expect(dependencies.query.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "order",
        filters: { id: "order_123" },
      }),
      { throwIfKeyNotFound: true }
    )
    expect(dependencies.notificationService.createNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        template: "order-confirmation",
        trigger_type: "order.placed",
        resource_id: "order_123",
        idempotency_key: "order-placed:order_123",
        content: expect.objectContaining({ subject: "Order 42 confirmed" }),
      })
    )
  })

  it("does not queue a shipment notification when the workflow opts out", async () => {
    const dependencies = createDependencies({})

    await orderNotifications({
      event: {
        name: OrderWorkflowEvents.FULFILLMENT_CREATED,
        data: {
          order_id: "order_123",
          fulfillment_id: "fulfillment_123",
          no_notification: true,
        },
      },
      container: dependencies.container,
      pluginOptions: {},
    } as never)

    expect(dependencies.query.graph).not.toHaveBeenCalled()
    expect(dependencies.notificationService.createNotifications).not.toHaveBeenCalled()
  })

  it("queues a shipment notification with carrier details", async () => {
    const dependencies = createDependencies({
      id: "order_123",
      display_id: 42,
      email: "customer@example.com",
      currency_code: "usd",
      fulfillments: [
        {
          id: "fulfillment_123",
          labels: [
            {
              tracking_number: "TRACK-123",
              tracking_url: "https://carrier.example/track/TRACK-123",
            },
          ],
        },
      ],
    })

    await orderNotifications({
      event: {
        name: OrderWorkflowEvents.FULFILLMENT_CREATED,
        data: {
          order_id: "order_123",
          fulfillment_id: "fulfillment_123",
        },
      },
      container: dependencies.container,
      pluginOptions: {},
    } as never)

    expect(dependencies.notificationService.createNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "shipment",
        idempotency_key: "shipment:order_123:fulfillment_123",
        data: expect.objectContaining({
          tracking_number: "TRACK-123",
          tracking_url: "https://carrier.example/track/TRACK-123",
        }),
      })
    )
  })

  it("queues a password reset without storing the raw token in the idempotency key", async () => {
    const dependencies = createDependencies({})

    await orderNotifications({
      event: {
        name: AuthWorkflowEvents.PASSWORD_RESET,
        data: {
          entity_id: "customer@example.com",
          actor_type: "customer",
          token: "secret-reset-token",
          metadata: {
            reset_url: "https://store.example/reset-password",
          },
        },
      },
      container: dependencies.container,
      pluginOptions: {},
    } as never)

    const notification =
      dependencies.notificationService.createNotifications.mock.calls[0][0]
    expect(notification).toMatchObject({
      to: "customer@example.com",
      template: "password-reset",
      trigger_type: "auth.password_reset",
      resource_type: "auth",
      data: expect.objectContaining({
        reset_url:
          "https://store.example/reset-password?token=secret-reset-token&actor_type=customer",
      }),
    })
    expect(notification.idempotency_key).not.toContain("secret-reset-token")
  })

  it("logs and does not throw when a notification dependency fails", async () => {
    const dependencies = createDependencies({
      id: "order_123",
      email: "customer@example.com",
    })
    dependencies.notificationService.createNotifications.mockRejectedValueOnce(
      new Error("offline provider")
    )

    await expect(
      orderNotifications({
        event: {
          name: OrderWorkflowEvents.PLACED,
          data: { id: "order_123" },
        },
        container: dependencies.container,
        pluginOptions: {},
      } as never)
    ).resolves.toBeUndefined()

    expect(dependencies.logger.error).toHaveBeenCalledWith(
      "Failed to queue notification for order.placed",
      expect.any(Error)
    )
  })
})
