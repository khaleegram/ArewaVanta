#!/bin/sh
set -eu

cd /var/www/html
php artisan config:cache --no-interaction
exec "$@"
