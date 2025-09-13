import express from 'express';
import cors from 'cors';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Tạo thư mục uploads nếu chưa tồn tại
const uploadsDir = path.join(__dirname, '../uploads');
const outputsDir = path.join(__dirname, '../outputs');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(outputsDir)) {
    fs.mkdirSync(outputsDir, { recursive: true });
}

// Cấu hình multer cho upload files
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const originalName = file.originalname;
        cb(null, `${timestamp}-${originalName}`);
    }
});

const upload = multer({ 
    storage,
    fileFilter: (req, file, cb) => {
        // Chấp nhận video và audio files
        const allowedTypes = /mp4|avi|mov|wmv|flv|webm|mp3|wav|aac|ogg/;
        const mimeType = allowedTypes.test(file.mimetype);
        const extName = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimeType && extName) {
            cb(null, true);
        } else {
            cb(new Error('Chỉ chấp nhận file video và audio!'));
        }
    },
    limits: {
        fileSize: 500 * 1024 * 1024 // 500MB
    }
});

// Helper function để lấy thời lượng file
const getFileDuration = (filePath: string): Promise<number> => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                reject(err);
            } else {
                const duration = metadata.format.duration || 0;
                resolve(duration);
            }
        });
    });
};

// Routes
app.get('/', (req, res) => {
    res.json({
        message: 'FFmpeg Service API',
        endpoints: {
            'POST /loop-video': 'Loop video với số lần tùy chỉnh',
            'POST /merge-audio': 'Kết nối audio với video',
            'POST /replace-audio': 'Thay thế audio trong video',
            'POST /smart-loop-merge': 'Tự động loop video theo thời lượng audio và merge'
        }
    });
});

// Smart Loop and Merge endpoint
app.post('/smart-loop-merge', upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'audio', maxCount: 1 }
]), async (req, res) => {
    try {
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        
        if (!files.video || !files.audio) {
            return res.status(400).json({ error: 'Vui lòng upload cả file video và audio' });
        }

        const videoPath = files.video[0].path;
        const audioPath = files.audio[0].path;
        const outputFilename = `smart-merged-${Date.now()}-${files.video[0].originalname}`;
        const outputPath = path.join(outputsDir, outputFilename);
        const tempLoopedVideoPath = path.join(outputsDir, `temp-looped-${Date.now()}.mp4`);

        console.log('Đang phân tích thời lượng file...');

        try {
            // Lấy thời lượng của audio và video
            const audioDuration = await getFileDuration(audioPath);
            const videoDuration = await getFileDuration(videoPath);

            console.log(`Audio duration: ${audioDuration} seconds`);
            console.log(`Video duration: ${videoDuration} seconds`);

            // Tính số loop cần thiết (làm tròn lên)
            const requiredLoops = Math.ceil(audioDuration / videoDuration);
            console.log(`Cần loop video ${requiredLoops} lần để match với audio`);

            // Bước 1: Loop video
            await new Promise<void>((resolve, reject) => {
                console.log(`Đang loop video ${requiredLoops} lần...`);

                ffmpeg(videoPath)
                    .inputOptions(['-stream_loop', (requiredLoops - 1).toString()])
                    .outputOptions(['-c', 'copy'])
                    .output(tempLoopedVideoPath)
                    .on('start', (commandLine) => {
                        console.log('Loop FFmpeg command:', commandLine);
                    })
                    .on('progress', (progress) => {
                        console.log(`Loop progress: ${Math.round(progress.percent || 0)}% done`);
                    })
                    .on('end', () => {
                        console.log('Video loop hoàn thành!');
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error('Loop FFmpeg error:', err);
                        reject(err);
                    })
                    .run();
            });

            // Bước 2: Merge looped video với audio
            await new Promise<void>((resolve, reject) => {
                console.log('Đang merge looped video với audio...');

                ffmpeg(tempLoopedVideoPath)
                    .input(audioPath)
                    .outputOptions([
                        '-c:v', 'copy',  // Giữ nguyên video codec
                        '-c:a', 'aac',   // Encode audio thành AAC
                        '-map', '0:v:0', // Map video từ looped video
                        '-map', '1:a:0', // Map audio từ file audio
                        '-t', audioDuration.toString(), // Cắt theo thời lượng audio
                        '-avoid_negative_ts', 'make_zero'
                    ])
                    .output(outputPath)
                    .on('start', (commandLine) => {
                        console.log('Merge FFmpeg command:', commandLine);
                    })
                    .on('progress', (progress) => {
                        console.log(`Merge progress: ${Math.round(progress.percent || 0)}% done`);
                    })
                    .on('end', () => {
                        console.log('Smart loop and merge hoàn thành!');
                        
                        // Cleanup files
                        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
                        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                        if (fs.existsSync(tempLoopedVideoPath)) fs.unlinkSync(tempLoopedVideoPath);
                        
                        res.json({
                            message: 'Video đã được loop và merge với audio thành công!',
                            outputFile: outputFilename,
                            downloadUrl: `/download/${outputFilename}`,
                            statistics: {
                                audioDuration: Math.round(audioDuration * 100) / 100,
                                videoDuration: Math.round(videoDuration * 100) / 100,
                                requiredLoops: requiredLoops,
                                finalDuration: Math.round(audioDuration * 100) / 100
                            }
                        });
                        
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error('Merge FFmpeg error:', err);
                        reject(err);
                    })
                    .run();
            });

        } catch (analysisError) {
            console.error('Error analyzing files:', analysisError);
            
            // Cleanup
            if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
            if (fs.existsSync(tempLoopedVideoPath)) fs.unlinkSync(tempLoopedVideoPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            
            res.status(500).json({ 
                error: 'Lỗi khi phân tích file: ' + (analysisError as Error).message 
            });
        }

    } catch (error) {
        console.error('Smart loop merge error:', error);
        res.status(500).json({ error: 'Lỗi server: ' + (error as Error).message });
    }
});

// Loop video endpoint
app.post('/loop-video', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Vui lòng upload file video' });
        }

        const { loops = 3 } = req.body;
        const inputPath = req.file.path;
        const outputFilename = `looped-${Date.now()}-${req.file.originalname}`;
        const outputPath = path.join(outputsDir, outputFilename);

        console.log(`Đang loop video ${loops} lần...`);

        ffmpeg(inputPath)
            .inputOptions(['-stream_loop', (loops - 1).toString()])
            .outputOptions(['-c', 'copy'])
            .output(outputPath)
            .on('start', (commandLine) => {
                console.log('FFmpeg command:', commandLine);
            })
            .on('progress', (progress) => {
                console.log(`Processing: ${Math.round(progress.percent || 0)}% done`);
            })
            .on('end', () => {
                console.log('Video loop hoàn thành!');
                
                // Xóa file input để tiết kiệm dung lượng
                fs.unlinkSync(inputPath);
                
                res.json({
                    message: 'Video đã được loop thành công!',
                    outputFile: outputFilename,
                    downloadUrl: `/download/${outputFilename}`,
                    loops: loops
                });
            })
            .on('error', (err) => {
                console.error('FFmpeg error:', err);
                
                // Cleanup
                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                
                res.status(500).json({ error: 'Lỗi khi xử lý video: ' + err.message });
            })
            .run();

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Lỗi server: ' + (error as Error).message });
    }
});

// Merge audio with video endpoint
app.post('/merge-audio', upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'audio', maxCount: 1 }
]), async (req, res) => {
    try {
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        
        if (!files.video || !files.audio) {
            return res.status(400).json({ error: 'Vui lòng upload cả file video và audio' });
        }

        const videoPath = files.video[0].path;
        const audioPath = files.audio[0].path;
        const outputFilename = `merged-${Date.now()}-${files.video[0].originalname}`;
        const outputPath = path.join(outputsDir, outputFilename);

        console.log('Đang merge audio với video...');

        ffmpeg(videoPath)
            .input(audioPath)
            .outputOptions([
                '-c:v', 'copy', // Giữ nguyên video codec
                '-c:a', 'aac',  // Encode audio thành AAC
                '-map', '0:v:0', // Map video từ input đầu tiên
                '-map', '1:a:0', // Map audio từ input thứ hai
                '-shortest'      // Dừng khi track ngắn nhất kết thúc
            ])
            .output(outputPath)
            .on('start', (commandLine) => {
                console.log('FFmpeg command:', commandLine);
            })
            .on('progress', (progress) => {
                console.log(`Processing: ${Math.round(progress.percent || 0)}% done`);
            })
            .on('end', () => {
                console.log('Audio merge hoàn thành!');
                
                // Cleanup input files
                fs.unlinkSync(videoPath);
                fs.unlinkSync(audioPath);
                
                res.json({
                    message: 'Audio đã được merge với video thành công!',
                    outputFile: outputFilename,
                    downloadUrl: `/download/${outputFilename}`
                });
            })
            .on('error', (err) => {
                console.error('FFmpeg error:', err);
                
                // Cleanup
                if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
                if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                
                res.status(500).json({ error: 'Lỗi khi merge audio: ' + err.message });
            })
            .run();

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Lỗi server: ' + (error as Error).message });
    }
});

// Replace audio in video endpoint
app.post('/replace-audio', upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'audio', maxCount: 1 }
]), async (req, res) => {
    try {
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        
        if (!files.video || !files.audio) {
            return res.status(400).json({ error: 'Vui lòng upload cả file video và audio' });
        }

        const videoPath = files.video[0].path;
        const audioPath = files.audio[0].path;
        const outputFilename = `replaced-${Date.now()}-${files.video[0].originalname}`;
        const outputPath = path.join(outputsDir, outputFilename);

        console.log('Đang thay thế audio trong video...');

        ffmpeg(videoPath)
            .input(audioPath)
            .outputOptions([
                '-c:v', 'copy', // Giữ nguyên video
                '-c:a', 'aac',  // Encode audio mới
                '-map', '0:v',  // Lấy video từ file đầu
                '-map', '1:a',  // Lấy audio từ file thứ hai (thay thế audio cũ)
                '-shortest'
            ])
            .output(outputPath)
            .on('start', (commandLine) => {
                console.log('FFmpeg command:', commandLine);
            })
            .on('progress', (progress) => {
                console.log(`Processing: ${Math.round(progress.percent || 0)}% done`);
            })
            .on('end', () => {
                console.log('Audio replacement hoàn thành!');
                
                // Cleanup input files
                fs.unlinkSync(videoPath);
                fs.unlinkSync(audioPath);
                
                res.json({
                    message: 'Audio trong video đã được thay thế thành công!',
                    outputFile: outputFilename,
                    downloadUrl: `/download/${outputFilename}`
                });
            })
            .on('error', (err) => {
                console.error('FFmpeg error:', err);
                
                // Cleanup
                if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
                if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                
                res.status(500).json({ error: 'Lỗi khi thay thế audio: ' + err.message });
            })
            .run();

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Lỗi server: ' + (error as Error).message });
    }
});

// Download endpoint
app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(outputsDir, filename);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File không tồn tại' });
    }
    
    res.download(filePath, filename, (err) => {
        if (err) {
            console.error('Download error:', err);
            res.status(500).json({ error: 'Lỗi khi download file' });
        }
    });
});

// Error handling middleware
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File quá lớn! Giới hạn 500MB.' });
        }
    }
    
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Lỗi server không xác định' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 FFmpeg Service API đang chạy tại http://localhost:${PORT}`);
    console.log(`📁 Upload directory: ${uploadsDir}`);
    console.log(`📁 Output directory: ${outputsDir}`);
});
