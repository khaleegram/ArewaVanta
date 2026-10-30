FROM composer:2.8

RUN apk add --no-cache libpq \
    && apk add --no-cache --virtual .aga-pg-build-deps $PHPIZE_DEPS postgresql-dev \
    && docker-php-ext-install pdo_pgsql \
    && apk del .aga-pg-build-deps

WORKDIR /app
EXPOSE 8000
