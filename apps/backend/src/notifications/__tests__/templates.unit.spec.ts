import {
  buildPasswordResetUrl,
  NotificationTemplate,
  renderNotificationTemplate,
} from "../templates"

describe("notification templates", () => {
  it("renders escaped order content and item data", () => {
    const content = renderNotificationTemplate(NotificationTemplate.ORDER_CONFIRMATION, {
      order_id: "order_123",
      display_id: 42,
      currency_code: "usd",
      total: 19.5,
      items: [{ title: "<Unsafe>", quantity: 2 }],
    })

    expect(content.subject).toBe("Order 42 confirmed")
    expect(content.text).toContain("2 × <Unsafe>")
    expect(content.html).toContain("&lt;Unsafe&gt;")
    expect(content.html).not.toContain("<Unsafe>")
    expect(content.html).toContain("USD 19.50")
  })

  it("renders tracking details only when the URL is safe", () => {
    const content = renderNotificationTemplate(NotificationTemplate.SHIPMENT, {
      order_id: "order_123",
      tracking_number: "TRACK-123",
      tracking_url: "javascript:alert(1)",
    })

    expect(content.subject).toBe("Your order order_123 has shipped")
    expect(content.text).toContain("TRACK-123")
    expect(content.text).not.toContain("Track your shipment: javascript")
    expect(content.html).not.toContain("href=")
  })

  it("renders a password reset link and rejects missing links", () => {
    const content = renderNotificationTemplate(NotificationTemplate.PASSWORD_RESET, {
      reset_url: "https://store.example/reset-password?token=abc",
      expires_in_minutes: 15,
    })

    expect(content.html).toContain("https://store.example/reset-password")
    expect(() =>
      renderNotificationTemplate(NotificationTemplate.PASSWORD_RESET, {})
    ).toThrow("safe password reset URL is required")
  })

  it("builds password reset URLs from metadata or the configured storefront URL", () => {
    expect(
      buildPasswordResetUrl(
        "token with spaces",
        "customer",
        { reset_url: "https://store.example/reset?token={token}" }
      )
    ).toBe(
      "https://store.example/reset?token=token+with+spaces&actor_type=customer"
    )

    expect(
      buildPasswordResetUrl("token-123", "user", {}, "http://localhost:8000")
    ).toBe(
      "http://localhost:8000/reset-password?token=token-123&actor_type=user"
    )

    expect(
      buildPasswordResetUrl("token-123", "user", {}, "javascript:alert(1)")
    ).toBeUndefined()
  })
})
