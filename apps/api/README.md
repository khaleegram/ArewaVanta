# ArewaVanta API

See the [project README](../../README.md) for local setup, testing, and API workflows.

## Captain invitations and admin notifications

A platform admin can open a clan’s **Captains** screen and send an email invitation. The recipient can create an account or sign in to an existing account; invitation links expire after seven days and can be used once. Set `FRONTEND_URL` to the public web origin and configure Laravel’s `MAIL_MAILER`, sender address and transport credentials in `apps/api/.env`. The `log` and `array` transports do not deliver email, so invitations are rejected until a delivery transport is configured.

Admins see clan and roster changes in the Activity menu. To enable browser push, configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` in `apps/api/.env`, clear cached Laravel configuration, and select **Enable browser push** in Activity. Generate a key pair locally with:

```sh
docker compose exec api php -r 'require "vendor/autoload.php"; print_r(\Minishlink\WebPush\VAPID::createVapidKeys());'
```

Keep the private key secret. Browser push requires a supported browser and HTTPS (or localhost); each admin must opt in on their own device. In-app activity remains available when push is not configured or delivery fails. Apply new migrations with `docker compose exec api php artisan migrate`.
