import { CloudWatchLogsClient, 
  CreateLogGroupCommand, 
  CreateLogStreamCommand, 
  DescribeLogStreamsCommand, 
  PutLogEventsCommand, 
  InvalidSequenceTokenException, 
  ResourceAlreadyExistsException 
} from '@aws-sdk/client-cloudwatch-logs';
import pThrottle from 'p-throttle';
import build from 'pino-abstract-transport';

export interface PinoCloudwatchTransportOptions { 
  logGroupName: string,
  logStreamName: string,
  awsRegion?: string,
  awsAccessKeyId?: string,
  awsSecretAccessKey?: string,
  interval?: number
}
interface Log {
  timestamp: number,
  message: string
}

function isInvalidSequenceTokenException(err: unknown): err is InvalidSequenceTokenException {
  if(err instanceof Error) {
    return err.name === 'InvalidSequenceTokenException';
  }
  return false;
}

function isResourceAlreadyExistsException(err: unknown): err is ResourceAlreadyExistsException {
  if(err instanceof Error) {
    return err.name === 'ResourceAlreadyExistsException';
  }
  return false;
}

export default async function (options: PinoCloudwatchTransportOptions) {

  const { logGroupName, logStreamName, awsRegion, awsAccessKeyId, awsSecretAccessKey } = options;
  const interval = options.interval || 1_000;

  let credentials;

  if (awsAccessKeyId && awsSecretAccessKey) {
    credentials = {
      accessKeyId: awsAccessKeyId,
      secretAccessKey: awsSecretAccessKey
    }
  }
  
  const client = new CloudWatchLogsClient({ region: awsRegion, credentials });

  let sequenceToken: string | undefined;

  async function createLogGroup(logGroupName: string) {
    try {
      await client.send(new CreateLogGroupCommand({ logGroupName }))
    } catch (error: unknown) {
      if (isResourceAlreadyExistsException(error)) {
        return;
      } else {
        throw error;
      }
    }
  }

  async function createLogStream(logGroupName: string, logStreamName: string) {
    try {
      await client.send(new CreateLogStreamCommand({ 
        logGroupName, 
        logStreamName 
      }));
    } catch (error: unknown) {
      if (isResourceAlreadyExistsException(error)) {
        return;
      } else {
        throw error;
      }
    }
  }

  async function nextToken(logGroupName: string, logStreamName: string) {
    const output = await client.send(new DescribeLogStreamsCommand({ 
      logGroupName, 
      logStreamNamePrefix: logStreamName 
    }));
    if(output.logStreams?.length === 0) {
      throw new Error('LogStream not found.');
    }

    sequenceToken = output.logStreams?.[0].uploadSequenceToken;
  }

  async function putEventLogs(logGroupName: string, logStreamName: string , logEvents: Log[]) {
    if(logEvents.length === 0) return;
    try {
      const output = await client.send(new PutLogEventsCommand({ 
        logEvents,
        logGroupName,
        logStreamName,
        sequenceToken
       }));
       sequenceToken = output.nextSequenceToken;
    } catch (error: unknown) {
      if(isInvalidSequenceTokenException(error)) {
        sequenceToken = error.expectedSequenceToken;
      } else {
        throw error;
      }
    }
  }  

  const { addLog, getLogs, wipeLogs } = (function() {

    let lastFlush = Date.now();

    // https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/cloudwatch_limits_cwl.html
    const MAX_EVENT_SIZE = (2 ** 10) * 256; // 256 Kb

    // https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutLogEvents.html
    const MAX_BUFFER_LENGTH = 10_000;
    const MAX_BUFFER_SIZE = 1_048_576;

    const bufferedLogs: Log[] = [];

    
    function reachedNumberOfLogsLimit(): boolean {
      return bufferedLogs.length === MAX_BUFFER_LENGTH;
    }

    function reachedBufferSizeLimit(newLog: Log): boolean {
      const currentSize = bufferedLogs.reduce((acc, curr) => acc + curr.message.length + 26, 0);

      return (currentSize + newLog.message.length + 26) >= MAX_BUFFER_SIZE;
    }
    
    function logEventExceedsSize(log: Log): boolean {
      return log.message.length >= MAX_EVENT_SIZE;
    }

    function getLogs(): Log[] {
      return bufferedLogs;
    }

    function shouldDoAPeriodicFlush() {
      const now = Date.now();
      const timeSinceLastFlush = now - lastFlush;
      lastFlush = now;
      return timeSinceLastFlush > interval;
    }

    function addLog(log: Log): boolean {
      if(logEventExceedsSize(log)) {
        return false;
      }
      if(!reachedBufferSizeLimit(log)) {
        bufferedLogs.push(log);
        return reachedNumberOfLogsLimit() || shouldDoAPeriodicFlush();
      } else {
        setImmediate(() => {
          addLog(log);
        });
        return true;
      }
    }

    function wipeLogs(): void {
      bufferedLogs.length = 0; // TODO: is there a better/more performant way to wipe the array?
    }

    return { addLog, getLogs, wipeLogs };
  })();

  const throttle = pThrottle({
    interval: 1000,
    limit: 1
  });

  const flush = throttle(async function() {
    await putEventLogs(logGroupName, logStreamName, getLogs());
    wipeLogs();
  });

  await createLogGroup(logGroupName);
  await createLogStream(logGroupName, logStreamName);
  try {
    await nextToken(logGroupName, logStreamName);
  } catch (e: any) {
    addLog({
      timestamp: Date.now(),
      message: JSON.stringify({ message: 'pino-cloudwatch-transport error', error: e.message })
    })
  }
  
  
  return build(async function (source) {
    for await (const obj of source) {
      try{
        const shouldFlush = addLog(obj);
        if(shouldFlush) {
          await flush();
          source.emit('flushed');
        }
      } catch (e) {
        console.error('ERROR', e);
        throw e;
      }
      
    }
  }, {
    
    parseLine: (line) => {
      let value;
      try {
        value = JSON.parse(line); // TODO: what should be done on failure to parse?
      } catch (e) {
        value = '{}' ;
      }
      return {
        timestamp: value.time || Date.now(),
        message: line
      }
    },
    close: async () => {
      await flush(); 
      client.destroy();
    }
  })
}