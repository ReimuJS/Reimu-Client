import { Buffer } from "buffer/";
import { pack } from "msgpackr/pack";
import { numToHex, rawTypes } from "..";
import { Message } from "../message/Message";

export default function createWebSocketManager<MessageType>(
  ws: WebSocket
): WebSocketManager<MessageType> {
  let currentMessageId = 0;

  let awaitingData: Buffer[] = [];

  let disconnected: number = -1;

  function sendRaw(packedMessage: Buffer) {
    if (disconnected === -1 && ws.bufferedAmount < 512) {
      ws.send(packedMessage);
    } else {
      packedMessage[0] != rawTypes.USDATA && awaitingData.push(packedMessage);
    }
  }
  let replyHandlers: { id: number; handler: (message: any) => any }[] = [];

  let acknoledgeList: {
    in: {
      [rawTypes.UDATA]: number[];
      [rawTypes.URES]: number[];
    };
    out: {
      [rawTypes.UDATA]: { id: number; data: Buffer }[];
      [rawTypes.URES]: { id: number; data: Buffer }[];
    };
  } = {
    in: {
      [rawTypes.UDATA]: [],
      [rawTypes.URES]: [],
    },
    out: {
      [rawTypes.UDATA]: [],
      [rawTypes.URES]: [],
    },
  };

  return {
    ws,

    disconnected,
    expectedClose: false,
    mayReconnect: true,

    acknoledgeList,

    currentMessageId,

    awaitingData,
    replyHandlers,

    sendRaw,

    send: (data, onReply) => {
      const id = currentMessageId++;
      const message = Buffer.concat([
        Buffer.from([rawTypes.UDATA]),
        numToHex(id),
        pack(data),
      ]);
      sendRaw(message);

      acknoledgeList.out[rawTypes.UDATA].push({ id, data: message });

      onReply && replyHandlers.push({ id, handler: onReply });
    },

    stream: (data) => {
      const message = Buffer.concat([
        Buffer.from([rawTypes.USDATA]),
        pack(data),
      ]);
      sendRaw(message);
    },

    reply: (originalMessage, data) => {
      const message = Buffer.concat([
        Buffer.from([rawTypes.URES]),
        numToHex(originalMessage.id),
        pack(data),
      ]);
      sendRaw(message);

      acknoledgeList.out[rawTypes.URES].push({
        id: originalMessage.id,
        data: message,
      });
    },
  };
}

export interface WebSocketManager<MessageType> {
  /** The raw websocket. */
  ws: WebSocket;

  /** Unix time value (or -1 if connected). */
  disconnected: number;
  /** If the client is allowed to reconnect (if ws was not closed normally). */
  mayReconnect: boolean;
  /** If the client expected this to close (aka client closed it). */
  expectedClose: boolean;

  /** List of outgoing ids waiting to be acknoledged and inboung ids already acknoledged. */
  acknoledgeList: {
    in: Record<rawTypes.UDATA | rawTypes.URES, number[]>;
    out: Record<rawTypes.UDATA | rawTypes.URES, { id: number; data: Buffer }[]>;
  };
  /** Array of bufferred data awaiting backpressure to be drained . */
  awaitingData: Buffer[];
  /** Array of reply handlers. */
  replyHandlers: { id: number; handler: (message: any) => any }[];

  /** The current Message id. */
  currentMessageId: number;

  /** Sends a raw message. */
  sendRaw: (packedMessage: Buffer) => void;
  /** Send a message. */
  send: (data: any, onReply?: (message: any) => any) => void;
  /** Send a stream message (message that isn't always expected to be recieved). */
  stream: (data: any) => void;
  /** Send a reply. */
  reply(originalMessage: Message<MessageType>, data: any): void;

  /** Arbitrary user data may be attached to this object. */
  [key: string]: any;
}
