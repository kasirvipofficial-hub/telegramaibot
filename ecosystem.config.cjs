module.exports = {
    apps: [
        {
            name: 'bot-engine',
            script: './bot-engine/server.js',
            cwd: './',
            watch: false,
            env: {
                NODE_ENV: 'production'
            },
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: './logs/bot-error.log',
            out_file: './logs/bot-out.log',
        },
        {
            name: 'video-engine',
            script: './video-engine/src/server.js',
            cwd: './',
            watch: false,
            env: {
                NODE_ENV: 'production'
            },
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: './logs/video-error.log',
            out_file: './logs/video-out.log',
        }
    ]
};
