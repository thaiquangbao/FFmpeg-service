FROM node:18-alpine

# Cài đặt FFmpeg
RUN apk add --no-cache ffmpeg

# Tạo thư mục làm việc
WORKDIR /app

# Copy và cài đặt dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Tạo thư mục cần thiết
RUN mkdir -p uploads outputs

# Expose port
EXPOSE 3000

# Start app
CMD ["npm", "start"]