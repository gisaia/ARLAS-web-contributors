#!/bin/bash
set -e

# rm -rf node_modules package-lock.json
# npm install

rm -r node_modules/arlas-api/*
cp ../ARLAS-web-core/node_modules/arlas-api/* node_modules/arlas-api/

sh ../ARLAS-web-core/build.sh

rm -r node_modules/arlas-web-core/*
cp -r ../ARLAS-web-core/dist/* node_modules/arlas-web-core/

npm run build-release


