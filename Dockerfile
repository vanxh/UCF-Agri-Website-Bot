# Use Node.js LTS version (20+ required for Next.js)
FROM node:20-alpine

# Install dependencies for Puppeteer (required for whatsapp-web.js)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application files
COPY . .

# Build Next.js application
RUN npm run build

# Create necessary directories
RUN mkdir -p temp .wwebjs_auth .wwebjs_cache

# Expose ports
# 3000 for Next.js dashboard
EXPOSE 3000

# Create a startup script to run both services
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo '# Clean up stale Chromium lock files from previous runs' >> /app/start.sh && \
    echo 'rm -f /app/.wwebjs_cache/*/SingletonLock 2>/dev/null || true' >> /app/start.sh && \
    echo 'rm -f /app/.wwebjs_cache/*/SingletonCookie 2>/dev/null || true' >> /app/start.sh && \
    echo 'rm -f /app/.wwebjs_cache/*/SingletonSocket 2>/dev/null || true' >> /app/start.sh && \
    echo 'rm -rf /app/.wwebjs_cache/*/Singleton* 2>/dev/null || true' >> /app/start.sh && \
    echo '# Start services' >> /app/start.sh && \
    echo 'npm run next-start &' >> /app/start.sh && \
    echo 'npm start' >> /app/start.sh && \
    chmod +x /app/start.sh

# Start both services
CMD ["/app/start.sh"]
