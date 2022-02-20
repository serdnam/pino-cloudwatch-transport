# @serdnam/pino-cloudwatch-transport

Pino v7+ transport for sending logs to AWS CloudWatch Logs, built using [pino-abstract-transport](https://github.com/pinojs/pino-abstract-transport) and the [AWS SDK for JavaScript v3](https://github.com/aws/aws-sdk-js-v3).

## Install

```
npm i @serdnam/pino-cloudwatch-transport
```

## Configuration

This transport expects the following options:

```ts
export interface PinoCloudwatchTransportOptions { 
  logGroupName: string,
  logStreamName: string,
  awsRegion?: string,
  awsAccessKeyId?: string,
  awsSecretAccessKey?: string,
  interval?: number
}
```

You may optionally pass in the `awsRegion`, `awsAccessKeyId` and `awsSecretAccessKey` options, otherwise, the AWS SDK client will pick up those parameters from the environment (as described in the [AWS SDK for Javascript documentation](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/configuring-the-jssdk.html)).

The transport, upon initialization, will create the LogGroup and LogStream with the names `logGroupName` and `logStreamName`, respectively, if they don't already exist.

After initializing the transport will start receiving logs from Pino formatting them in the format expected by CloudWatch:

```js
{
    timestamp: 1645381110905
    message: '{"level":30,"time":1645381110905,"pid":320325,"hostname":"andres-latitudee7440","msg":"Hello, CloudWatch Logs!"}'
}
```

The transport will use the `time` property of the received log as the `timestamp` if it finds it, otherwise, it will use `Date.now()`.

The transport will store received logs in a buffer, and will flush them out to CloudWatch using a `PutLogEvents` call when one of the following conditions is met:

* The buffer has reached the size limit described in the AWS CloudWatch documentation.

* The number of logs in the buffer has reached the size limit of 10,000 logs as described in the AWS CloudWatch documentation.

* The transport has just received a log, and the last time a log has been stored before this one was longer than `interval` miliseconds.


## Usage

After installing, you can use the transport as follows:

```ts
import 'dotenv/config';
import pino from "pino";

const transport = pino.transport({
    target: '@serdnam/pino-cloudwatch-transport',
    options: {
        logGroupName: 'pino-cloudwatch-test',
        logStreamName: 'pino-cloudwatch-test-stream',
        awsRegion: process.env.AWS_REGION,
        awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
        awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        interval: 1_000, // this is the default
    }
});

const logger = pino(transport);

logger.info('Hello, CloudWatch Logs!');

```

With Fastify:

```ts
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

```

## License

[MIT](./LICENSE)