module.exports = {
    apps: [
        {
            name: 'bot-engine',
            script: './server.js',
            cwd: './bot-engine',
            watch: false,
            env: {
                NODE_ENV: 'production'
            },
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: '../logs/bot-error.log',
            out_file: '../logs/bot-out.log',
        },
        {
            name: 'video-engine',
            script: './src/server.js',
            cwd: './video-engine',
            watch: false,
            env: {
                NODE_ENV: 'production'
            },
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: '../logs/video-error.log',
            out_file: '../logs/video-out.log',
        },
        {
            name: 'youtube-engine',
            script: './src/server.js',
            cwd: './youtube-engine',
            watch: false,
            env: {
                NODE_ENV: 'production',
                PORT: 3002
            },
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: '../logs/youtube-error.log',
            out_file: '../logs/youtube-out.log',
        }
    ]
};
