import winston from 'winston';

// Override with LOG_LEVEL environment variable (e.g., LOG_LEVEL=info npm start)
export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'warn',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...rest }) => {
            // Ensure consistent order: timestamp, level, message, then rest of fields
            const restString = Object.keys(rest)
                .filter(key => key !== 'service') // Exclude service since we add it in defaultMeta
                .sort()
                .map(key => `${key}: ${JSON.stringify(rest[key])}`)
                .join(', ');
            return `${timestamp} ${level}: ${message}${restString ? ` (${restString})` : ''}`;
        })
    ),
    defaultMeta: { service: 'poly-websockets' },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize({
                    all: true,
                    colors: {
                        error: 'red',
                        warn: 'yellow',
                        info: 'cyan',
                        debug: 'green'
                    }
                })
            )
        })
    ]
});