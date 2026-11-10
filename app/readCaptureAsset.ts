const chunkSize = 2 * 1024 * 1024;
const minChunkSize = 256 * 1024;
const maxParallel = 6;

class PermanentResponseError extends Error {}
class UseFullResponse extends PermanentResponseError {}
class CompleteScene extends Error {
  buffer: ArrayBuffer;
  constructor(buffer: ArrayBuffer) { super(); this.buffer = buffer; }
}

async function retry<T>(signal: AbortSignal, request: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  try {
    return await request();
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof PermanentResponseError) throw error;
    // Both fetch() and reading an already-started response can fail.
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', cancel);
        resolve();
      }, 150);
      signal.addEventListener('abort', cancel, { once: true });
    });
    signal.throwIfAborted();
    return request();
  }
}

function validateAsset(buffer: ArrayBuffer, total = buffer.byteLength) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2) throw Error('Expected a binary glTF 2.0 scene');
  if (view.getUint32(8, true) !== total) throw Error('Incomplete GLB file');
  return buffer;
}

function identityEncoding(response: Response) {
  const encoding = response.headers.get('content-encoding');
  return !encoding || encoding.toLowerCase() === 'identity';
}

export async function readCaptureAsset(
  url: string, signal: AbortSignal, progress: (fraction: number) => void
): Promise<ArrayBuffer> {
  let highWater = 0;
  function report(fraction: number) {
    if (!signal.aborted && fraction > highWater) {
      highWater = fraction;
      progress(fraction);
    }
  }

  async function readFull(response: Response, active: AbortSignal) {
    if (response.status !== 200 || response.headers.has('content-range') || !response.body) {
      await response.body?.cancel();
      throw Error('Expected complete scene, HTTP ' + response.status);
    }
    const header = response.headers.get('content-length');
    // Fetch exposes decoded bytes for compressed bodies, but their header
    // describes the encoded transfer. The GLB header still checks decoded size.
    const length = identityEncoding(response) && header !== null ? Number(header) : null;
    const reader = response.body.getReader();
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let count = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        active.throwIfAborted();
        if (done) break;
        parts.push(new Uint8Array(value));
        count += value.byteLength;
        if (length !== null && length > 0) report(Math.min(.99, count / length));
      }
    } finally {
      reader.releaseLock();
    }
    if (length !== null && count !== length) throw Error('Incomplete scene response');
    const data = validateAsset(await new Blob(parts).arrayBuffer());
    active.throwIfAborted();
    report(1);
    return data;
  }

  type Part = { bytes: ArrayBuffer; total: number; etag: string | null };
  type Result = Part | { full: ArrayBuffer };
  let size: number | undefined;
  let etag: string | null = null;
  let completeResponse: Promise<ArrayBuffer> | undefined;
  const transfer = new AbortController();
  const cancelTransfer = () => transfer.abort(signal.reason);
  signal.throwIfAborted();
  signal.addEventListener('abort', cancelTransfer, { once: true });
  const active = transfer.signal;
  const assetUrl = url.split('#', 1)[0];
  const query = assetUrl.includes('?') ? '&' : '?';

  async function readRange(start: number, end: number): Promise<Result> {
    return retry(active, async () => {
      const response = await fetch(assetUrl + query + 'part=' + start + '&end=' + end, {
        headers: { Range: 'bytes=' + start + '-' + end }, signal: active
      });
      if ([400, 401, 403, 404, 410].includes(response.status)) {
        await response.body?.cancel();
        throw new PermanentResponseError('Scene HTTP ' + response.status);
      }
      if (response.status === 200) {
        // A server may ignore Range after we have already committed a prefix.
        // Use one entire 200, without splicing it into the earlier revision.
        if (completeResponse) await response.body?.cancel();
        else completeResponse = readFull(response, active);
        try {
          return { full: await completeResponse };
        } catch (error) {
          active.throwIfAborted();
          throw new UseFullResponse('Retry complete scene', { cause: error });
        }
      }
      if (response.status === 206 && !identityEncoding(response)) {
        await response.body?.cancel();
        throw new UseFullResponse('Server requires a complete scene download');
      }
      const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
      const total = Number(range?.[3]);
      const tag = response.headers.get('etag');
      if (response.status !== 206 || !range || !Number.isSafeInteger(total) || total <= start ||
          Number(range[1]) !== start || Number(range[2]) !== Math.min(end, total - 1)) {
        await response.body?.cancel();
        if (response.status === 206 && size === undefined && !range)
          throw new UseFullResponse('Unusable initial Content-Range');
        throw Error('Invalid scene range ' + start + '-' + end + ', HTTP ' + response.status);
      }
      if ((size !== undefined && total !== size) || (etag && tag && tag !== etag)) {
        await response.body?.cancel();
        throw new UseFullResponse('Scene changed during range download');
      }
      const bytes = await response.arrayBuffer();
      active.throwIfAborted();
      if (bytes.byteLength !== Number(range[2]) + 1 - start)
        throw Error('Incomplete scene range ' + start + '-' + end);
      return { bytes, total, etag: tag };
    });
  }

  // A proxy may repeatedly cut the same large response. Shrink that request
  // only, keeping retries bounded even for the initial size-discovery request.
  async function readPrefix(start: number, end: number): Promise<Result> {
    for (;;) {
      try {
        return await readRange(start, end);
      } catch (error) {
        active.throwIfAborted();
        if (error instanceof PermanentResponseError || end + 1 - start <= minChunkSize) throw error;
        end = start + Math.ceil((end + 1 - start) / 2) - 1;
      }
    }
  }

  try {
    const first = await readPrefix(0, chunkSize - 1);
    if ('full' in first) return first.full;
    validateAsset(first.bytes, first.total);
    size = first.total;
    etag = first.etag;
    const bytes = new Uint8Array(first.total);
    bytes.set(new Uint8Array(first.bytes));
    let next = first.bytes.byteLength;
    const blockSize = next;
    let received = next;
    if (received < bytes.length) report(received / bytes.length);
    async function readRemaining() {
      while (next < bytes.length) {
        const start = next;
        const end = Math.min(start + blockSize, bytes.length) - 1;
        next = end + 1;
        // Each worker owns a disjoint interval. Only complete, validated
        // prefixes are committed; failed attempts never add to received.
        let cursor = start;
        let target = end;
        while (cursor <= end) {
          const part = await readPrefix(cursor, target);
          active.throwIfAborted();
          if ('full' in part) throw new CompleteScene(part.full);
          bytes.set(new Uint8Array(part.bytes), cursor);
          cursor += part.bytes.byteLength;
          target = Math.min(end, cursor + part.bytes.byteLength - 1);
          received += part.bytes.byteLength;
          if (received < bytes.length) report(received / bytes.length);
        }
      }
    }
    const workers = Math.min(maxParallel, Math.ceil((bytes.length - next) / blockSize));
    await Promise.all(Array.from({ length: workers }, readRemaining));
    active.throwIfAborted();
    const result = validateAsset(bytes.buffer);
    report(1);
    return result;
  } catch (error) {
    transfer.abort();
    signal.throwIfAborted();
    if (error instanceof CompleteScene) return error.buffer;
    if (!(error instanceof UseFullResponse)) throw error;
    return retry(signal, async () => readFull(await fetch(assetUrl, { signal }), signal));
  } finally {
    signal.removeEventListener('abort', cancelTransfer);
  }
}
