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
    timeoutDelay: 5,
    reconnectTimeout: 40,
    ...options,
  };

  let generalTimer: NodeJS.Timeout | null = null;

  let reconnectAmount = 0;

  let ws: WebSocket;
  let id: string | null = null;

  function Open(newId: boolean = false) {
    generalTimer && clearInterval(generalTimer);
    generalTimer = null;
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

    generalTimer = setInterval(() => {
      if (conn.awaitingData.length > 0 && ws.bufferedAmount < 512) {
        conn.sendRaw(
          createBufferMessage(
            conn.awaitingData.splice(0, conn.awaitingData.length)
          )
        );
        if (conn.disconnected == -1) {
          let packets = [
            ...conn.acknoledgeList.out[rawTypes.UDATA].map(({ data }) => data),
            ...conn.acknoledgeList.out[rawTypes.URES].map(({ data }) => data),
          ];
          if (packets.length) {
            conn.sendRaw(createBufferMessage(packets));
          }
        }
      }
    }, opts.timeoutDelay * 1000);

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
          Reconnect(true);
          return;
        }
        const rawMessage = decodeRawMessage(data);
        const handleMessage = (decoded: messageDecoded) => {
          switch (decoded.type) {
            case rawTypes.ACK:
              {
                const packet = conn.acknoledgeList.out[decoded.to].find(
                  (x) => x.id == decoded.id
                );
                if (packet) {
                  const i = conn.acknoledgeList.out[decoded.to].indexOf(packet);
                  if (i > -1) {
                    conn.acknoledgeList.out[decoded.to].splice(i, 1);
                  }
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
            case rawTypes.USDATA: {
              if (opts.stream) {
                opts.stream(unpack(decoded.data));
              }
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
              ws.close(4002, "Invalid Message");
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
            ws.close(4002, "Invalid Message");
          }
        }
      } else {
        id = data;
        reconnectAmount = 0;
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
        default:
          opts.disconnect && opts.disconnect(conn, event.reason);
          break;
      }
      if (conn.mayReconnect) {
        Reconnect(conn.disconnected);
      }
    };
  }

  function Reconnect(disconnected: number): void;
  function Reconnect(newId: true): void;
  function Reconnect(arg: number | true) {
    setTimeout(() => {
      if (
        (typeof arg === "number"
          ? arg + opts.reconnectTimeout * 1000 > Date.now()
          : true) && opts.connectAttempts
          ? reconnectAmount < opts.connectAttempts
          : true
      ) {
        Open(arg === true);
      }
    }, 2 ** reconnectAmount * 500);
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
  /** The maximum amount of connection attempts allowed before it will stop trying to connect. */
  connectAttempts?: number;

  /** Number of seconds to check for general events. Defaults to 5. */
  timeoutDelay: number;
  /** Maximum time in seconds that the client can be disconnected before it will no longer be allowed to reconnect. Defaults to 40. */
  reconnectTimeout: number;

  /** Handler for when the connection is opened / reconnected. */
  open?: (connection: WebSocketManager<MessageType>) => any;
  /** Handler for new Message. */
  message?: (message: Message<MessageType>) => any;
  /** Handler for stream data (data that isn't always expected to be recieved). */
  stream?: (message: any) => any;
  /** Handler for disconnection due to ping timeout / couldn't connect (reconnects still allowed). */
  disconnect?: (connection: WebSocketManager<MessageType>, reason: any) => any;
  /** Handler for close event. */
  close?: (connection: WebSocketManager<MessageType>, reason: any) => any;
}
