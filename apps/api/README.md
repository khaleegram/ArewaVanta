# ArewaVanta API

See the [project README](../../README.md) for local setup, testing, and API workflows.

## Captain invitations and admin notifications

A platform admin can open a clan’s **Captains** screen and send an email invitation. The recipient can create an account or sign in to an existing account; invitation links expire after seven days and can be used once. Set `FRONTEND_URL` to the public web origin and configure Laravel’s `MAIL_MAILER`, sender address and transport credentials in `apps/api/.env`. The `log` and `array` transports do not deliver email, so invitations are rejected until a delivery transport is configured.

The public squad history route, `/api/v1/squads/{slug}/history`, returns recorded public competition history using the same standings calculator as event leaderboards. Configure comma-separated exact frontend origins with `CORS_ALLOWED_ORIGINS`; leave it empty when the API is served under the frontend's same origin. Credentialed cross-origin requests remain disabled because the web client authenticates with bearer tokens.

Password recovery uses `POST /api/v1/auth/forgot-password` and `POST /api/v1/auth/reset-password`. Link requests return the same response whether or not an account exists; Laravel stores hashed one-use tokens for 60 minutes. Successful resets revoke that user's existing Sanctum tokens. Configure `FRONTEND_URL` and the existing Laravel mail transport so the branded email links to the frontend reset page. Public player and clan search is limited to 30 requests per IP per minute; other public reads are limited to 120, while login, registration, password recovery and invitation routes retain tighter endpoint limits.

Use the shared email layout in `resources/views/emails/layout.blade.php` for transactional email. Keep the dark ArewaVanta palette, coral accents, readable mobile layout, and a plain-text alternative.

Admins see clan and roster changes in the Activity menu. To enable browser push, configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` in `apps/api/.env`, clear cached Laravel configuration, and select **Enable browser push** in Activity. Generate a key pair locally with:

```sh
docker compose exec api php -r 'require "vendor/autoload.php"; print_r(\Minishlink\WebPush\VAPID::createVapidKeys());'
```

Keep the private key secret. Browser push requires a supported browser and HTTPS (or localhost); each admin must opt in on their own device. In-app activity remains available when push is not configured or delivery fails. Apply new migrations with `docker compose exec api php artisan migrate`.
