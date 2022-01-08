import { Buffer } from "buffer/";
import { unpack } from "msgpackr/unpack";
import { WebSocketManager } from "../websocket/WebSocketManager";

export default function createMessage<MessageType>(
  connection: WebSocketManager<MessageType>,
  id: number,
  rawMessage: Buffer
): Message<MessageType> {
  const messageUnpacked = unpack(rawMessage);
  const message: Message<MessageType> = {
    id,
    data: messageUnpacked,

    reply: (reply: any) => {
      connection.reply(message, reply);
    },
  };
  return message;
}

export interface Message<MessageType> {
  /** An incrementing id. */
  id: number;

  /** The message data. */
  data: MessageType;

  /** Reply to the message. */
  reply: (reply: any) => void;

  /** Arbitrary user data may be attached to this object */
  [key: string]: any;
}
