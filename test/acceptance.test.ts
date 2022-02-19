import 'dotenv/config';
import { Transform } from 'stream';
import { setImmediate } from 'timers/promises';
import { once } from 'events';
import pino from 'pino';
import tap from 'tap';
import pRetry, { AbortError } from 'p-retry';

import { CloudWatchLogsClient, DeleteLogGroupCommand, DeleteLogStreamCommand, GetLogEventsCommand, GetLogEventsCommandOutput } from '@aws-sdk/client-cloudwatch-logs';

import pinoCloudwatchTransport from '../index.js';

const AWS_REGION = process.env.AWS_REGION;

const client = new CloudWatchLogsClient({ region: AWS_REGION })

const LOG_GROUP_NAME = 'pino-cloudwatch-transport';

const LOG_STREAM_NAME = 'pino-cloudwatch-transport-stream';

const RETRY_OPTIONS = { minTimeout: 100, factor: 2.5, retries: 10 };

function parseAndReturnMessages(output: GetLogEventsCommandOutput) {
    return output.events && output.events
        .map(event => JSON.parse(event.message ? event.message : 'null'))
        .filter(event => event);
}

async function getLogEventsOutput(before: number, after: number) {
    let output;
    try {
        output = await client.send(new GetLogEventsCommand({ 
            logGroupName: LOG_GROUP_NAME,
            logStreamName: LOG_STREAM_NAME,
            limit: 10, 
            startTime: before, 
            endTime: after }));
    } catch (e: unknown) {
        if(e instanceof Error) {
            throw new AbortError(`Client error ${e.message}`);
        }
        throw e;
    }

    if(output.events?.length === 0) throw new Error('Events have not been persisted yet.');
    return output;
}

tap.test('Logging', async (t) => {
    let instance: Transform;
    t.beforeEach(async () => {
        instance = await pinoCloudwatchTransport({
            logGroupName: LOG_GROUP_NAME,
            logStreamName: LOG_STREAM_NAME,
            awsRegion: AWS_REGION
        });
    });

    t.afterEach(async () => {
        await client.send(new DeleteLogStreamCommand({
            logGroupName: LOG_GROUP_NAME,
            logStreamName: LOG_STREAM_NAME
        }));
    });

    t.teardown(async () => {
        await client.send(new DeleteLogGroupCommand({
            logGroupName: LOG_GROUP_NAME
        }));
        
    })
    
    t.test('Should be able to log a single line', async (t) => {
        t.plan(1);

        const log = pino(instance);
        const before = Date.now();

        log.info(t.name)

        await setImmediate();

        instance.end();

        await once(instance, 'close');

        const after = Date.now();

        const output = await pRetry(() => getLogEventsOutput(before, after), RETRY_OPTIONS);
        
        const messages = parseAndReturnMessages(output);

        t.ok(messages?.find((message) => {
            return message.msg === t.name;
        }));
    });

    t.test('Should be able to log multiple lines', async (t) => {
        t.plan(5);

        const log = pino(instance);
        const before = Date.now();

        
        log.info(t.name);
        log.info(t.name);
        log.info(t.name);
        log.info(t.name);
        log.info(t.name);

        await setImmediate();
        
        instance.end();

        await once(instance, 'close');

        const after = Date.now();

        const output = await pRetry(() => getLogEventsOutput(before, after), RETRY_OPTIONS);
        
        const messages = parseAndReturnMessages(output);

        if (messages) {
            for(const message of messages) {
                t.equal(message.msg, t.name);
            }
        }
    });
    
    
})

