import type {
  CallOptions,
  ChannelCredentials,
  Client,
  ClientOptions,
  ClientUnaryCall,
  requestCallback,
  ServiceDefinition,
} from '@grpc/grpc-js';
import type { XrayStat, XrayStatsTransport } from './xrayStats/transport';
export type { XrayStat } from './xrayStats/transport';

interface QueryStatsRequest {
  pattern: string;
  reset: boolean;
}

interface QueryStatsResponse {
  stat: XrayStat[];
}

type GrpcRuntime = typeof import('@grpc/grpc-js');

interface StatsServiceClient extends Client {
  queryStats(
    request: QueryStatsRequest,
    options: CallOptions,
    callback: requestCallback<QueryStatsResponse>,
  ): ClientUnaryCall;
}

type StatsServiceClientConstructor = new (
  address: string,
  credentials: ChannelCredentials,
  options?: ClientOptions,
) => StatsServiceClient;

const SERVICE_NAME = 'xray.app.stats.command.StatsService';
const QUERY_STATS_PATH = `/${SERVICE_NAME}/QueryStats`;

function encodeVarint(value: number | bigint): Buffer {
  const bytes: number[] = [];
  let current = BigInt(value);
  do {
    let byte = Number(current & 0x7fn);
    current >>= 7n;
    if (current !== 0n) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (current !== 0n);
  return Buffer.from(bytes);
}

function readVarint(
  buffer: Buffer,
  offset: number,
): { value: bigint; offset: number } {
  let value = 0n;
  let shift = 0n;
  let cursor = offset;

  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    cursor += 1;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value, offset: cursor };
    }
    shift += 7n;
  }

  throw new Error('Truncated protobuf varint');
}

function writeLengthDelimited(fieldTag: number, value: Buffer): Buffer {
  return Buffer.concat([
    encodeVarint(fieldTag),
    encodeVarint(value.length),
    value,
  ]);
}

function skipField(buffer: Buffer, offset: number, wireType: number): number {
  switch (wireType) {
    case 0:
      return readVarint(buffer, offset).offset;
    case 1:
      return offset + 8;
    case 2: {
      const length = readVarint(buffer, offset);
      return length.offset + Number(length.value);
    }
    case 5:
      return offset + 4;
    default:
      throw new Error(`Unsupported protobuf wire type: ${wireType}`);
  }
}

function serializeQueryStatsRequest(request: QueryStatsRequest): Buffer {
  const chunks: Buffer[] = [];
  if (request.pattern) {
    chunks.push(writeLengthDelimited(10, Buffer.from(request.pattern, 'utf8')));
  }
  if (request.reset) {
    chunks.push(encodeVarint(16), encodeVarint(1));
  }
  return Buffer.concat(chunks);
}

function deserializeQueryStatsRequest(buffer: Buffer): QueryStatsRequest {
  let offset = 0;
  const request: QueryStatsRequest = { pattern: '', reset: false };
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);
    if (fieldNumber === 1 && wireType === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      const end = offset + Number(length.value);
      request.pattern = buffer.subarray(offset, end).toString('utf8');
      offset = end;
    } else if (fieldNumber === 2 && wireType === 0) {
      const value = readVarint(buffer, offset);
      request.reset = value.value !== 0n;
      offset = value.offset;
    } else {
      offset = skipField(buffer, offset, wireType);
    }
  }
  return request;
}

function serializeStat(stat: XrayStat): Buffer {
  const chunks: Buffer[] = [];
  if (stat.name) {
    chunks.push(writeLengthDelimited(10, Buffer.from(stat.name, 'utf8')));
  }
  chunks.push(
    encodeVarint(16),
    encodeVarint(Math.max(0, Math.floor(stat.value))),
  );
  return Buffer.concat(chunks);
}

function deserializeStat(buffer: Buffer): XrayStat {
  let offset = 0;
  const stat: XrayStat = { name: '', value: 0 };
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);
    if (fieldNumber === 1 && wireType === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      const end = offset + Number(length.value);
      stat.name = buffer.subarray(offset, end).toString('utf8');
      offset = end;
    } else if (fieldNumber === 2 && wireType === 0) {
      const value = readVarint(buffer, offset);
      stat.value = Number(value.value);
      offset = value.offset;
    } else {
      offset = skipField(buffer, offset, wireType);
    }
  }
  return stat;
}

function serializeQueryStatsResponse(response: QueryStatsResponse): Buffer {
  return Buffer.concat(
    response.stat.map((stat) => writeLengthDelimited(10, serializeStat(stat))),
  );
}

function deserializeQueryStatsResponse(buffer: Buffer): QueryStatsResponse {
  let offset = 0;
  const stat: XrayStat[] = [];
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);
    if (fieldNumber === 1 && wireType === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      const end = offset + Number(length.value);
      stat.push(deserializeStat(buffer.subarray(offset, end)));
      offset = end;
    } else {
      offset = skipField(buffer, offset, wireType);
    }
  }
  return { stat };
}

const statsServiceDefinition = {
  queryStats: {
    path: QUERY_STATS_PATH,
    requestStream: false,
    responseStream: false,
    requestSerialize: serializeQueryStatsRequest,
    requestDeserialize: deserializeQueryStatsRequest,
    responseSerialize: serializeQueryStatsResponse,
    responseDeserialize: deserializeQueryStatsResponse,
    originalName: 'QueryStats',
  },
} satisfies ServiceDefinition;

export class XrayStatsClient implements XrayStatsTransport {
  private client: StatsServiceClient | null = null;
  private grpcRuntime: GrpcRuntime | null = null;
  private clientConstructor: StatsServiceClientConstructor | null = null;

  public constructor(private readonly address: string) {}

  public async queryStats(
    pattern: string,
    timeoutMs: number,
  ): Promise<XrayStat[]> {
    const client = await this.getClient();
    return new Promise((resolve, reject) => {
      client.queryStats(
        { pattern, reset: false },
        { deadline: Date.now() + timeoutMs },
        (error, response) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(response?.stat ?? []);
        },
      );
    });
  }

  public close(): void {
    if (this.client && this.grpcRuntime) {
      this.grpcRuntime.closeClient(this.client);
      this.client = null;
    }
  }

  private async getClient(): Promise<StatsServiceClient> {
    if (!this.client) {
      const grpc = await this.getGrpcRuntime();
      const ClientConstructor = this.clientConstructor;
      if (!ClientConstructor) {
        throw new Error('Xray StatsService client constructor is unavailable');
      }
      this.client = new ClientConstructor(
        this.address,
        grpc.credentials.createInsecure(),
      );
    }
    return this.client;
  }

  private async getGrpcRuntime(): Promise<GrpcRuntime> {
    if (!this.grpcRuntime || !this.clientConstructor) {
      const grpc = await import('@grpc/grpc-js');
      this.grpcRuntime = grpc;
      this.clientConstructor = grpc.makeGenericClientConstructor(
        statsServiceDefinition,
        SERVICE_NAME,
      ) as unknown as StatsServiceClientConstructor;
    }
    return this.grpcRuntime;
  }
}
