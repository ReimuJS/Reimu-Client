import { Buffer } from "buffer/";
import { unpack } from "msgpackr";
import { numToHex, rawTypes } from ".";
import { decodeRawMessage, messageDecoded } from "./message";
import createMessage, { Message } from "./message/Message";
import createWebSocketManager, {
  WebSocketManager,
} from "./websocket/WebSocketManager";

export default function Client<MessageType>(
  endpoint: string,
  options?: Partial<options<MessageType>>
) {
  const opts: options<MessageType> = {
    reconnectTimeout: 40,
    ...options,
  };

  let ws: WebSocket;
  let id: string | null = null;

  function Open(newId: boolean = false) {
    if (newId) id = null;
    if (ws) {
      // Discard the old socket entirely
      ws.onopen = () => {};
      ws.onmessage = () => {};
      ws.onerror = () => {};
      ws.onclose = () => {};
      ws.close();
    }

    ws = new WebSocket(endpoint);
    let conn = createWebSocketManager(ws);
    ws.binaryType = "arraybuffer";

    //TODO Timer to check for buffer drainage

    ws.onopen = () => {
      if (newId || !id) {
        ws.send("hello");
      } else {
        ws.send(id);
      }
    };
    ws.onmessage = (event) => {
      const data = event.data;
      if (data instanceof ArrayBuffer) {
        if (!id) {
          Open(true);
          return;
        }
        const rawMessage = decodeRawMessage(data);
        const handleMessage = (decoded: messageDecoded) => {
          switch (decoded.type) {
            case rawTypes.ACK:
              {
                const i = conn.acknoledgeList.out[decoded.to].indexOf(
                  decoded.id
                );
                if (i > -1) {
                  conn.acknoledgeList.out[decoded.to].splice(i, 1);
                }
              }
              break;
            case rawTypes.UDATA: {
              if (!conn.acknoledgeList.in[decoded.type].includes(decoded.id)) {
                if (opts.message) {
                  const message = createMessage<MessageType>(
                    conn,
                    decoded.id,
                    decoded.data
                  );
                  opts.message(message);
                }
                conn.acknoledgeList.in[decoded.type].push(decoded.id);
              }
              return createAckMessage(decoded.id, rawTypes.UDATA);
            }
            case rawTypes.URES: {
              if (!conn.acknoledgeList.in[decoded.type].includes(decoded.id)) {
                const replyHandler = conn.replyHandlers.find(
                  (r) => r.id == decoded.id
                );
                if (replyHandler) {
                  const data = unpack(decoded.data);
                  replyHandler.handler(data);
                }
                conn.acknoledgeList.in[decoded.type].push(decoded.id);
              }
              return createAckMessage(decoded.id, rawTypes.URES);
            }
          }
        };
        if (Array.isArray(rawMessage)) {
          let bufferSend: Buffer[] = [];
          rawMessage.some((message) => {
            try {
              const output = handleMessage(message);
              if (output && bufferSend) {
                bufferSend.push(output);
              }
              return false;
            } catch (e) {
              conn.expectedClose = true;
              ws.close(1002, "Invalid Message");
              return true;
            }
          });
          if (bufferSend.length > 0) {
            conn.sendRaw(createBufferMessage(bufferSend));
          }
        } else {
          try {
            const output = handleMessage(rawMessage);
            if (output) {
              conn.sendRaw(output);
            }
          } catch (e) {
            conn.expectedClose = true;
            ws.close(1002, "Invalid Message");
          }
        }
      } else {
        id = data;
        opts.open && opts.open(conn);
      }
    };
    ws.onclose = (event) => {
      conn.disconnected = new Date().getTime();
      switch (event.code) {
        case 1000:
          conn.mayReconnect = false;
          opts.close && opts.close(conn, event.reason);
          break;
        case 1002:
          opts.disconnect && opts.disconnect(conn, event.reason);
          break;
        case 1006:
          opts.disconnect && opts.disconnect(conn, event.reason);
          break;
        default:
          opts.disconnect && opts.disconnect(conn, event.reason);
          break;
      }
    };
  }

  Open(true);
}

function createAckMessage(id: number, to: rawTypes) {
  return Buffer.concat([Buffer.from([rawTypes.ACK, to]), numToHex(id)]);
}

function createBufferMessage(buffers: Buffer[]): Buffer {
  let toConcat = [Buffer.from([rawTypes.UBUF])];
  for (const buffer of buffers) {
    toConcat.push(numToHex(buffer.length));
    toConcat.push(buffer);
  }
  return Buffer.concat(toConcat);
}

export interface options<MessageType> {
  /** Maximum time in seconds that the client can be disconnected before it will no longer be allowed to reconnect. Defaults to 40. */
  reconnectTimeout: number;

  /** Handler for when the connection is opened / reconnected. */
  open?: (connection: WebSocketManager<MessageType>) => any;
  /** Handler for new Message. */
  message?: (message: Message<MessageType>) => any;
  /** Handler for disconnection due to ping timeout (reconnects still allowed). */
  disconnect?: (connection: WebSocketManager<MessageType>, reason: any) => any;
  /** Handler for close event. */
  close?: (connection: WebSocketManager<MessageType>, reason: any) => any;
}
