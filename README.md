# FFmpeg Service API

API service để xử lý video bằng FFmpeg với các chức năng:
- Loop video với số lần tùy chỉnh
- Merge audio với video 
- Thay thế audio trong video

## Cài đặt

```bash
npm install
```

## Chạy development

```bash
npm run dev
```

## Build và chạy production

```bash
npm run build
npm start
```

## API Endpoints

### 1. Loop Video
**POST** `/loop-video`

Form-data:
- `video`: File video cần loop
- `loops`: Số lần lặp (default: 3)

### 2. Merge Audio với Video  
**POST** `/merge-audio`

Form-data:
- `video`: File video gốc
- `audio`: File audio cần merge

### 3. Thay thế Audio trong Video
**POST** `/replace-audio`

Form-data:
- `video`: File video có audio cần thay thế
- `audio`: File audio mới

### 4. Download File
**GET** `/download/:filename`

## Ví dụ sử dụng với curl

```bash
# Loop video 5 lần
curl -X POST http://localhost:3000/loop-video \
  -F "video=@input.mp4" \
  -F "loops=5"

# Merge audio với video
curl -X POST http://localhost:3000/merge-audio \
  -F "video=@video.mp4" \
  -F "audio=@audio.mp3"

# Thay thế audio
curl -X POST http://localhost:3000/replace-audio \
  -F "video=@video_with_audio.mp4" \
  -F "audio=@new_audio.wav"

# Download file đã xử lý
curl -O http://localhost:3000/download/processed-video.mp4
```

## Lưu ý

- File upload tối đa: 500MB
- Supported formats: mp4, avi, mov, wmv, flv, webm, mp3, wav, aac, ogg
- Files được tự động xóa sau khi xử lý để tiết kiệm dung lượng
- Output files được lưu trong thư mục `outputs/`

## Requirements

- Node.js >= 14
- FFmpeg binary phải được cài đặt trên hệ thống