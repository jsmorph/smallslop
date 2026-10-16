import { createHash } from "node:crypto";

const websocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const closeCodes = {
  protocolError: 1002,
  messageTooBig: 1009,
};

const opcodes = {
  binary: 0x2,
  close: 0x8,
  continuation: 0x0,
  ping: 0x9,
  pong: 0xa,
  text: 0x1,
};

function buildAcceptValue(key) {
  return createHash("sha1")
    .update(`${key}${websocketGuid}`)
    .digest("base64");
}

function encodeFrame(opcode, payload) {
  const length = payload.length;
  let header;

  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

class WebSocketConnection {
  constructor(socket, { maxMessageBytes, maxBufferedBytes }) {
    this.socket = socket;
    this.maxMessageBytes = maxMessageBytes;
    this.maxBufferedBytes = maxBufferedBytes;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.fragments = null;
    this.onClose = () => {};
    this.onMessage = () => {};

    socket.on("data", (chunk) => {
      if (this.closed) {
        return;
      }

      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processBuffer();
    });

    const finish = () => {
      if (!this.closed) {
        this.closed = true;
        this.onClose();
      }
    };

    socket.on("close", finish);
    socket.on("error", finish);
  }

  processBuffer() {
    while (!this.closed) {
      const frame = this.readFrame();

      if (!frame) {
        return;
      }

      if (frame.opcode === opcodes.close) {
        this.close();
        return;
      }

      if (frame.opcode === opcodes.ping) {
        this.write(encodeFrame(opcodes.pong, frame.payload));
        continue;
      }

      if (frame.opcode === opcodes.pong) {
        continue;
      }

      // Browsers fragment large messages: an initial text or binary
      // frame without FIN, continuation frames, and a final one with
      // FIN.  Reassemble; only text messages are delivered.
      if (frame.opcode === opcodes.text || frame.opcode === opcodes.binary) {
        if (this.fragments) {
          this.close(closeCodes.protocolError);
          return;
        }

        if (!frame.fin) {
          this.fragments = { opcode: frame.opcode, parts: [frame.payload], size: frame.payload.length };
          continue;
        }

        if (frame.opcode === opcodes.text) {
          this.onMessage(frame.payload.toString("utf-8"));
        }

        continue;
      }

      if (frame.opcode !== opcodes.continuation || !this.fragments) {
        this.close(closeCodes.protocolError);
        return;
      }

      this.fragments.parts.push(frame.payload);
      this.fragments.size += frame.payload.length;

      if (this.fragments.size > this.maxMessageBytes) {
        this.close(closeCodes.messageTooBig);
        return;
      }

      if (frame.fin) {
        const { opcode, parts } = this.fragments;
        this.fragments = null;

        if (opcode === opcodes.text) {
          this.onMessage(Buffer.concat(parts).toString("utf-8"));
        }
      }
    }
  }

  readFrame() {
    const buffer = this.buffer;

    if (buffer.length < 2) {
      return null;
    }

    const fin = (buffer[0] & 0x80) !== 0;
    const reserved = buffer[0] & 0x70;
    const opcode = buffer[0] & 0x0f;
    const masked = (buffer[1] & 0x80) !== 0;
    let payloadLength = buffer[1] & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (buffer.length < offset + 2) {
        return null;
      }

      payloadLength = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (buffer.length < offset + 8) {
        return null;
      }

      payloadLength = Number(buffer.readBigUInt64BE(offset));
      offset += 8;
    }

    // RFC 6455 requires masked client frames, clear reserved bits, and
    // unfragmented control frames of at most 125 bytes.
    const control = (opcode & 0x08) !== 0;

    if (!masked || reserved || (control && (!fin || payloadLength > 125))) {
      this.close(closeCodes.protocolError);
      return null;
    }

    if (payloadLength > this.maxMessageBytes) {
      this.close(closeCodes.messageTooBig);
      return null;
    }

    if (buffer.length < offset + 4) {
      return null;
    }

    const maskKey = buffer.subarray(offset, offset + 4);
    offset += 4;

    if (buffer.length < offset + payloadLength) {
      return null;
    }

    const payload = Buffer.from(buffer.subarray(offset, offset + payloadLength));

    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= maskKey[index % 4];
    }

    this.buffer = buffer.subarray(offset + payloadLength);
    return { fin, opcode, payload };
  }

  write(frame) {
    this.socket.write(frame);

    // A peer that stops reading would otherwise make the server buffer
    // every later message.
    if (this.socket.writableLength > this.maxBufferedBytes) {
      this.closed = true;
      this.socket.destroy();
      this.onClose();
    }
  }

  send(text) {
    if (this.closed) {
      return;
    }

    this.write(encodeFrame(opcodes.text, Buffer.from(text, "utf-8")));
  }

  close(code) {
    if (this.closed) {
      return;
    }

    this.closed = true;
    const payload = Buffer.alloc(code ? 2 : 0);

    if (code) {
      payload.writeUInt16BE(code);
    }

    this.socket.end(encodeFrame(opcodes.close, payload));
    this.onClose();
  }
}

export function acceptWebSocket(request, socket, { maxMessageBytes = 2 * 1024 * 1024, maxBufferedBytes = 16 * 1024 * 1024 } = {}) {
  const key = request.headers["sec-websocket-key"];

  if (!key || request.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return null;
  }

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${buildAcceptValue(key)}`,
      "\r\n",
    ].join("\r\n"),
  );

  socket.setNoDelay(true);
  return new WebSocketConnection(socket, { maxMessageBytes, maxBufferedBytes });
}
