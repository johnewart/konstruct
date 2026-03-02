# Dockerfile for Konstruct Agent Container
# This image contains TypeScript runtime, Git, and agent configuration

FROM node:22-alpine

# Install additional tools
RUN apk add --no-cache \
    git \
    bash \
    curl \
    wget

# Create working directory
WORKDIR /app

# Copy agent files
COPY package*.json ./
COPY dist/ ./dist/
COPY src/ ./src/

# Install dependencies
RUN npm install --production

# Set environment variables
ENV NODE_ENV=production
ENV AGENT_MODE=docker
ENV AGENT_PORT=8000

# Expose agent port
EXPOSE 8000

# Entry point for Docker containers
CMD ["node", "dist/agent/agent-worker-docker.js"]
