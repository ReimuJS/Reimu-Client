import { EventEmitter } from "events";
import Message from "./Message/index";
import * as msgpack from "msgpack-lite";

export class Reimu extends EventEmitter {
  constructor(url: string) {
    super();

    this.url = url;
    this.connect();
    this.messageId = 0;
    this.connected = false;
  }

  // Variables

  private url;
  private ws?: WebSocket;
  private messageId;
  private closeCode: number;
  private connected: boolean;

  /**
   * Packets that haven't been acknoledged
   * @type {DecodedMessage[]}
   */
  public droppedPackets: DecodedMessage[] = [];

  /**
   * Messages that are awaiting callbacks
   * @type {any[]}
   */
  public awaitCallback: {
    id: number;
    type: string;
    data: any;
    callback:
      | { cb: (data: Message) => void; type: "response" }
      | { cb: () => void; type: "acknoledge" };
  }[] = [];

  // Functions

  private sendRaw = async (
    data: any,
    callback?:
      | { cb: (data: Message) => void; type: "response" }
      | { cb: () => void; type: "acknoledge" },
    system?: boolean
  ) => {
    const dataEncoded = msgpack.encode(data);
    this.ws?.send(dataEncoded);

    this.droppedPackets.push({ ...data, system: !!system });

    if (!!callback) {
      this.awaitCallback.push({ ...data, callback });
    } else return;
  };

  private connect = () => {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";

    this.ws.addEventListener("open", this.open);
    this.ws.addEventListener("message", this.message);
    this.ws.addEventListener("error", this.error);
    this.ws.addEventListener("close", this.close);
  };
  /**
   * Attempts to disconnect with the user
   * @param {number} code - The error code
   */
  public disconnect = (code: number) => {
    this.closeCode = code;
    const mId = this.messageId++;

    const ifNotAcknoledge = setInterval(() => {
      if (this.connected) this.ws.close(code);
    }, 10000);
    this.sendRaw(
      {
        id: mId,
        type: "close",
        data: { code },
      },
      {
        cb: () => {
          clearInterval(ifNotAcknoledge);
          this.ws.close(code);
        },
        type: "acknoledge",
      },
      true
    );
  };

  private open = (event: Event) => {};
  private message = (event: MessageEvent) => {
    new Message(event, this);
  };
  private error = (event: Event) => {};
  private close = (event: CloseEvent) => {
    this.ws.removeEventListener("open", this.open);
    this.ws.removeEventListener("message", this.message);
    this.ws.removeEventListener("error", this.error);
    this.ws.removeEventListener("close", this.close);

    this.emit("close", this.closeCode || event.code, !this.closeCode);
    this.connected = false;
  };

  /**
   * Responds to the message.
   * @param {any} data - Data to be sent
   * @param {Message} message - Message Class
   * @returns {void}
   */
  public respond = (data: any, message: Message): void => {
    this.sendRaw({ for: message.id, type: "response", data });
  };
}

interface DecodedMessage {
  id: number;
  type: string;
  data: any;
  system: boolean;
}
