
# Use Node 18 Alpine for small footprint
FROM node:18-alpine

# Install FFmpeg
RUN apk add --no-cache ffmpeg python3 make g++

# Set working directory
WORKDIR /app

# Install dependencies first (caching)
COPY package*.json ./
RUN npm install --production

# Copy source code
COPY . .

# Create temp directories
RUN mkdir -p tmp/uploads data/jobs && chown -R node:node /app

# Switch to non-root user
USER node

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
