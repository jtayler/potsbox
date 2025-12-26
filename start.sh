#!/usr/bin/env bash
set -e


docker compose down
docker compose up -d
sleep 2
docker exec -it asterisk asterisk -rx "dialplan reload"
