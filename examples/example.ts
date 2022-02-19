import 'dotenv/config';
import pino from "pino";

const transport = pino.transport({
    target: '@serdnam/pino-cloudwatch-transport',
    options: {
        logGroupName: 'test2',
        logStreamName: 'test2-stream',
        awsRegion: process.env.AWS_REGION,
        awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
        awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const logger = pino(transport);

logger.info('Hello, CloudWatch Logs!');
