# Multi-stage build: Node only exists in the build stage; the final image is just nginx + static files.
# Build:  docker build -t webgis-client:slim --build-arg VITE_MODE=static client
FROM node:22-alpine AS build
WORKDIR /app
# copy manifests first so the "npm ci" layer is cached until dependencies change
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY . .
ARG VITE_MODE=static
ARG VITE_BASE=./
ENV VITE_MODE=$VITE_MODE VITE_BASE=$VITE_BASE
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK CMD wget -q -O /dev/null http://localhost/ || exit 1
