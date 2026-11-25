import { createHash } from "node:crypto"
import type {
  INotificationModuleService,
  NotificationTypes,
} from "@medusajs/framework/types"
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework/subscribers"
import {
  AuthWorkflowEvents,
  ContainerRegistrationKeys,
  Modules,
  OrderWorkflowEvents,
} from "@medusajs/framework/utils"
import {
  buildPasswordResetUrl,
  NotificationTemplate,
  renderNotificationTemplate,
} from "../notifications/templates"

type OrderNotificationEvent = {
  id?: unknown
  order_id?: unknown
  fulfillment_id?: unknown
  no_notification?: unknown
  tracking_number?: unknown
  tracking_url?: unknown
}

type PasswordResetEvent = {
  entity_id?: unknown
  actor_type?: unknown
  token?: unknown
  metadata?: unknown
}

type OrderRecord = {
  id: string
  display_id?: unknown
  email?: unknown
  customer_id?: unknown
  currency_code?: unknown
  total?: unknown
  items?: unknown
  fulfillments?: unknown
}

type QueryGraphService = {
  graph: (
    input: {
      entity: string
      fields: string[]
      filters: Record<string, unknown>
    },
    options?: { throwIfKeyNotFound?: boolean }
  ) => Promise<{ data?: unknown[] }>
}

type SubscriberContainer = SubscriberArgs["container"]

const ORDER_FIELDS = [
  "id",
  "display_id",
  "email",
  "customer_id",
  "currency_code",
  "total",
  "items.*",
  "fulfillments.*",
  "fulfillments.labels.*",
]

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed || undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asOrder(value: unknown): OrderRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  const record = value as Record<string, unknown>
  const id = asString(record.id)
  return id ? ({ ...record, id } as OrderRecord) : undefined
}

function getLogger(container: SubscriberContainer) {
  return container.resolve(ContainerRegistrationKeys.LOGGER)
}

function getQuery(container: SubscriberContainer): QueryGraphService {
  return container.resolve(
    ContainerRegistrationKeys.QUERY
  ) as unknown as QueryGraphService
}

function getNotificationService(
  container: SubscriberContainer
): INotificationModuleService {
  return container.resolve(Modules.NOTIFICATION)
}

async function loadOrder(
  container: SubscriberContainer,
  orderId: string
): Promise<OrderRecord | undefined> {
  const { data } = await getQuery(container).graph(
    {
      entity: "order",
      fields: ORDER_FIELDS,
      filters: { id: orderId },
    },
    { throwIfKeyNotFound: true }
  )

  return asOrder(data?.[0])
}

function getOrderItems(order: OrderRecord): Array<Record<string, unknown>> {
  if (!Array.isArray(order.items)) {
    return []
  }

  return order.items.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return []
    }

    const record = item as Record<string, unknown>
    return [
      {
        title: asString(record.title) || "Item",
        variant_title: asString(record.variant_title),
        quantity: record.quantity,
      },
    ]
  })
}

function getFulfillment(
  order: OrderRecord,
  fulfillmentId: string
): Record<string, unknown> | undefined {
  if (!Array.isArray(order.fulfillments)) {
    return undefined
  }

  const fulfillment = order.fulfillments.find((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false
    }
    return asString((item as Record<string, unknown>).id) === fulfillmentId
  })

  return fulfillment && typeof fulfillment === "object" && !Array.isArray(fulfillment)
    ? (fulfillment as Record<string, unknown>)
    : undefined
}

function getTrackingData(
  fulfillment: Record<string, unknown> | undefined,
  event: OrderNotificationEvent
): { tracking_number?: string; tracking_url?: string } {
  const labels = fulfillment?.labels
  const firstLabel = Array.isArray(labels)
    ? labels.find(
        (label) =>
          label && typeof label === "object" && !Array.isArray(label)
      )
    : undefined
  const label =
    firstLabel && typeof firstLabel === "object" && !Array.isArray(firstLabel)
      ? (firstLabel as Record<string, unknown>)
      : {}

  return {
    tracking_number:
      asString(event.tracking_number) || asString(label.tracking_number),
    tracking_url: asString(event.tracking_url) || asString(label.tracking_url),
  }
}

async function createNotification(
  container: SubscriberContainer,
  data: NotificationTypes.CreateNotificationDTO
): Promise<void> {
  await getNotificationService(container).createNotifications(data)
}

export async function sendOrderPlacedNotification(
  container: SubscriberContainer,
  orderId: string
): Promise<boolean> {
  const logger = getLogger(container)
  const order = await loadOrder(container, orderId)
  const recipient = asString(order?.email)

  if (!order || !recipient) {
    logger.warn(`Skipped order confirmation for order ${orderId}: no email recipient`)
    return false
  }

  const data = {
    order_id: order.id,
    display_id: order.display_id,
    currency_code: order.currency_code,
    total: order.total,
    items: getOrderItems(order),
  }

  await createNotification(container, {
    to: recipient,
    channel: "email",
    template: NotificationTemplate.ORDER_CONFIRMATION,
    data,
    content: renderNotificationTemplate(NotificationTemplate.ORDER_CONFIRMATION, data),
    trigger_type: OrderWorkflowEvents.PLACED,
    resource_id: order.id,
    resource_type: "order",
    receiver_id: asString(order.customer_id),
    idempotency_key: `order-placed:${order.id}`,
  })

  return true
}

export async function sendShipmentNotification(
  container: SubscriberContainer,
  event: OrderNotificationEvent
): Promise<boolean> {
  const logger = getLogger(container)
  const orderId = asString(event.order_id)
  const fulfillmentId = asString(event.fulfillment_id)

  if (!orderId || !fulfillmentId) {
    logger.warn("Skipped shipment notification: event did not include order and fulfillment IDs")
    return false
  }

  const order = await loadOrder(container, orderId)
  const recipient = asString(order?.email)
  if (!order || !recipient) {
    logger.warn(`Skipped shipment notification for order ${orderId}: no email recipient`)
    return false
  }

  const fulfillment = getFulfillment(order, fulfillmentId)
  const tracking = getTrackingData(fulfillment, event)
  const data = {
    order_id: order.id,
    display_id: order.display_id,
    fulfillment_id: fulfillmentId,
    ...tracking,
  }

  await createNotification(container, {
    to: recipient,
    channel: "email",
    template: NotificationTemplate.SHIPMENT,
    data,
    content: renderNotificationTemplate(NotificationTemplate.SHIPMENT, data),
    trigger_type: OrderWorkflowEvents.FULFILLMENT_CREATED,
    resource_id: order.id,
    resource_type: "order",
    receiver_id: asString(order.customer_id),
    idempotency_key: `shipment:${order.id}:${fulfillmentId}`,
  })

  return true
}

export async function sendPasswordResetNotification(
  container: SubscriberContainer,
  event: PasswordResetEvent
): Promise<boolean> {
  const logger = getLogger(container)
  const recipient = asString(event.entity_id)
  const actorType = asString(event.actor_type)
  const token = asString(event.token)

  if (!recipient || !actorType || !token) {
    logger.warn("Skipped password reset notification: event payload is incomplete")
    return false
  }

  const resetUrl = buildPasswordResetUrl(token, actorType, asRecord(event.metadata))
  if (!resetUrl) {
    logger.warn(
      "Skipped password reset notification: configure STOREFRONT_URL or metadata.reset_url"
    )
    return false
  }

  const data = {
    actor_type: actorType,
    reset_url: resetUrl,
    expires_in_minutes: 15,
  }
  const tokenDigest = createHash("sha256").update(token).digest("hex").slice(0, 32)

  await createNotification(container, {
    to: recipient,
    channel: "email",
    template: NotificationTemplate.PASSWORD_RESET,
    data,
    content: renderNotificationTemplate(NotificationTemplate.PASSWORD_RESET, data),
    trigger_type: AuthWorkflowEvents.PASSWORD_RESET,
    resource_type: "auth",
    idempotency_key: `password-reset:${actorType}:${recipient}:${tokenDigest}`,
  })

  return true
}

export default async function orderNotifications({
  event,
  container,
}: SubscriberArgs<OrderNotificationEvent | PasswordResetEvent>): Promise<void> {
  try {
    switch (event.name) {
      case OrderWorkflowEvents.PLACED: {
        const orderId = asString((event.data as OrderNotificationEvent).id)
        if (orderId) {
          await sendOrderPlacedNotification(container, orderId)
        } else {
          getLogger(container).warn("Skipped order confirmation: event did not include an order ID")
        }
        return
      }
      case OrderWorkflowEvents.FULFILLMENT_CREATED: {
        const eventData = event.data as OrderNotificationEvent
        if (eventData.no_notification === true) {
          return
        }
        await sendShipmentNotification(container, eventData)
        return
      }
      case AuthWorkflowEvents.PASSWORD_RESET:
        await sendPasswordResetNotification(
          container,
          event.data as PasswordResetEvent
        )
        return
      default:
        return
    }
  } catch (error) {
    const logger = getLogger(container)
    logger.error(
      `Failed to queue notification for ${event.name}`,
      error instanceof Error ? error : new Error(String(error))
    )
  }
}

export const config: SubscriberConfig = {
  event: [
    OrderWorkflowEvents.PLACED,
    OrderWorkflowEvents.FULFILLMENT_CREATED,
    AuthWorkflowEvents.PASSWORD_RESET,
  ],
  context: {
    subscriberId: "order-notifications-handler",
  },
}
