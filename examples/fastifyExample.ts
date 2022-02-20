import Fastify from 'fastify';
import { request } from 'undici';
import pino from 'pino';

const transport = pino.transport({
    target: '@serdnam/pino-cloudwatch-transport',
    options: {
        logGroupName: 'pino-cloudwatch-test',
        logStreamName: 'pino-cloudwatch-test-stream',
        awsRegion: process.env.AWS_REGION,
        awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
        awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const logger = pino(transport);

const server = Fastify({ logger });

server.get('/', async function(req, reply){
    req.log.info('Hello, CloudWatch Logs!');
    return { message: 'OK' };
});

await server.listen(8888);

await request('http://localhost:8888/');

await server.close();