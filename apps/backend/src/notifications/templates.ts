import type { NotificationTypes } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

export const NotificationTemplate = {
  ORDER_CONFIRMATION: "order-confirmation",
  SHIPMENT: "shipment",
  PASSWORD_RESET: "password-reset",
} as const

export type NotificationTemplateId =
  (typeof NotificationTemplate)[keyof typeof NotificationTemplate]

type TemplateData = Record<string, unknown>

type ItemData = {
  title?: unknown
  quantity?: unknown
  variant_title?: unknown
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed || undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character] ?? character
  )
}

function getOrderLabel(data: TemplateData): string {
  const displayId = asNumber(data.display_id)
  return (
    (displayId !== undefined ? String(displayId) : undefined) ||
    asString(data.display_id) ||
    asString(data.order_id) ||
    "your order"
  )
}

function formatAmount(value: unknown, currencyCode: unknown): string | undefined {
  const amount = asNumber(value)
  const currency = asString(currencyCode)?.toUpperCase()

  if (amount === undefined || !currency) {
    return undefined
  }

  return `${currency} ${amount.toFixed(2)}`
}

function getItems(data: TemplateData): ItemData[] {
  if (!Array.isArray(data.items)) {
    return []
  }

  return data.items.filter(
    (item): item is ItemData =>
      typeof item === "object" && item !== null && !Array.isArray(item)
  )
}

function renderItemText(item: ItemData): string {
  const title = asString(item.title) || "Item"
  const variantTitle = asString(item.variant_title)
  const quantity = asNumber(item.quantity)
  const suffix = variantTitle ? ` (${variantTitle})` : ""

  return `${quantity ?? 1} × ${title}${suffix}`
}

function renderItemHtml(item: ItemData): string {
  return `<li>${escapeHtml(renderItemText(item))}</li>`
}

function safeHttpUrl(value: unknown): string | undefined {
  const candidate = asString(value)
  if (!candidate) {
    return undefined
  }

  try {
    const url = new URL(candidate)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined
    }
    return url.toString()
  } catch {
    return undefined
  }
}

function renderOrderConfirmation(data: TemplateData): NotificationTypes.NotificationContent {
  const orderLabel = getOrderLabel(data)
  const items = getItems(data)
  const itemText = items.length
    ? items.map(renderItemText).join("\n")
    : "Your order is being prepared."
  const itemHtml = items.length
    ? `<ul>${items.map(renderItemHtml).join("")}</ul>`
    : "<p>Your order is being prepared.</p>"
  const total = formatAmount(data.total, data.currency_code)
  const totalText = total ? `\nTotal: ${total}` : ""
  const totalHtml = total ? `<p><strong>Total:</strong> ${escapeHtml(total)}</p>` : ""

  return {
    subject: `Order ${orderLabel} confirmed`,
    text: [
      `Thanks for your order ${orderLabel}.`,
      "",
      itemText,
      totalText,
      "We will send another email when your order ships.",
    ]
      .filter(Boolean)
      .join("\n"),
    html: [
      `<p>Thanks for your order <strong>${escapeHtml(orderLabel)}</strong>.</p>`,
      itemHtml,
      totalHtml,
      "<p>We will send another email when your order ships.</p>",
    ].join(""),
  }
}

function renderShipment(data: TemplateData): NotificationTypes.NotificationContent {
  const orderLabel = getOrderLabel(data)
  const trackingNumber = asString(data.tracking_number)
  const trackingUrl = safeHttpUrl(data.tracking_url)
  const trackingText = trackingNumber
    ? `Tracking number: ${trackingNumber}`
    : "Tracking information will be available from the carrier soon."
  const trackingHtml = trackingNumber
    ? `<p>Tracking number: <strong>${escapeHtml(trackingNumber)}</strong></p>`
    : "<p>Tracking information will be available from the carrier soon.</p>"
  const trackingLink = trackingUrl
    ? `\nTrack your shipment: ${trackingUrl}`
    : ""
  const trackingLinkHtml = trackingUrl
    ? `<p><a href="${escapeHtml(trackingUrl)}">Track your shipment</a></p>`
    : ""

  return {
    subject: `Your order ${orderLabel} has shipped`,
    text: [
      `Your order ${orderLabel} is on its way.`,
      trackingText,
      trackingLink,
    ]
      .filter(Boolean)
      .join("\n"),
    html: [
      `<p>Your order <strong>${escapeHtml(orderLabel)}</strong> is on its way.</p>`,
      trackingHtml,
      trackingLinkHtml,
    ].join(""),
  }
}

function renderPasswordReset(
  data: TemplateData
): NotificationTypes.NotificationContent {
  const resetUrl = safeHttpUrl(data.reset_url)
  if (!resetUrl) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A safe password reset URL is required"
    )
  }

  const expiresInMinutes = asNumber(data.expires_in_minutes) ?? 15
  const expirationText = `This link expires in ${expiresInMinutes} minutes.`

  return {
    subject: "Reset your password",
    text: [
      "We received a request to reset your password.",
      `Reset it here: ${resetUrl}`,
      expirationText,
      "If you did not request this, you can safely ignore this email.",
    ].join("\n\n"),
    html: [
      "<p>We received a request to reset your password.</p>",
      `<p><a href="${escapeHtml(resetUrl)}">Reset your password</a></p>`,
      `<p>${escapeHtml(expirationText)}</p>`,
      "<p>If you did not request this, you can safely ignore this email.</p>",
    ].join(""),
  }
}

export function renderNotificationTemplate(
  template: NotificationTemplateId,
  data: TemplateData
): NotificationTypes.NotificationContent {
  switch (template) {
    case NotificationTemplate.ORDER_CONFIRMATION:
      return renderOrderConfirmation(data)
    case NotificationTemplate.SHIPMENT:
      return renderShipment(data)
    case NotificationTemplate.PASSWORD_RESET:
      return renderPasswordReset(data)
    default:
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unsupported notification template: ${template}`
      )
  }
}

export function buildPasswordResetUrl(
  token: string,
  actorType: string,
  metadata: Record<string, unknown> = {},
  baseUrl = process.env.STOREFRONT_URL || process.env.NEXT_PUBLIC_BASE_URL
): string | undefined {
  const encodedToken = encodeURIComponent(token)
  const encodedActorType = encodeURIComponent(actorType)
  const configuredUrl = asString(metadata.reset_url ?? metadata.resetUrl)
  const urlTemplate = configuredUrl ||
    (baseUrl ? `${baseUrl.replace(/\/$/, "")}/reset-password` : undefined)

  if (!urlTemplate) {
    return undefined
  }

  const replacedTemplate = urlTemplate
    .replace(/\{\{?token\}?\}/gi, encodedToken)
    .replace(/\{\{?actor_?type\}?\}/gi, encodedActorType)

  try {
    const url = new URL(replacedTemplate)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined
    }

    url.searchParams.set("token", token)
    url.searchParams.set("actor_type", actorType)
    return url.toString()
  } catch {
    return undefined
  }
}
