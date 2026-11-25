# Backend

Medusa v2 backend workspace. The backend and Worker will use the same image and configuration, with their runtime mode selected by deployment configuration.

The first local slice now includes the Redis-backed Caching, Event Bus, Workflow Engine, and Locking configuration, a controlled migration service, Admin asset linking, a tested Resend Notification Provider, order/shipment/password-reset notification templates and subscribers, local Store/Region/Sales Channel/Publishable API Key/test-product bootstrap, and a local Docker Compose path for PostgreSQL, Redis, Server, Worker, and Storefront. R2, payment, Storefront business behavior, and production operations are added in later phases.
