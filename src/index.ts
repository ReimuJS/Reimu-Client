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
  private connected: boolean;

  /**
   * Last sent packet
   */
  public lastContact: { client: Date; server: Date };

  /**
   * Close info
   */
  public close?: { code: number; server: boolean | "unexpected" | "ping" };

  /**
   * The id of the connection
   * @type {string}
   */
  public id?: string;

  /**
   * Packets that haven't been acknoledged
   * @type {DecodedMessage[]}
   */
  public droppedPackets: DecodedMessage[] = [];

  /**
   * Packets that are being queued
   * @type {DecodedMessage[]}
   */
  public queue: DecodedMessage[] = [];

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
    if (data.type != "batch") {
      this.droppedPackets.push({ ...data, system: !!system });

      if (!!callback) {
        this.awaitCallback.push({ ...data, callback });
      }

      if (this.ws.bufferedAmount > 512) {
        this.queue.push({ ...data, system: !!system });
        return;
      }
    }

    if (!this.connected) {
      this.queue.push({ ...data, system: !!system });
      return;
    }

    const dataEncoded = msgpack.encode(data);
    this.lastContact.client = new Date();
    this.ws?.send(dataEncoded);
  };

  private connect = () => {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";

    this.ws.addEventListener("open", this.open);
    this.ws.addEventListener("message", this.message);
    this.ws.addEventListener("error", this.error);
    this.ws.addEventListener("close", this.onClose);
  };

  /**
   * Attempts to disconnect with the user
   * @param {number} code - The error code
   */
  public disconnect = (code: number) => {
    this.close = { code, server: false };
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
    let decoded: any;
    try {
      decoded = msgpack.decode(new Uint8Array(event.data));
    } catch (e) {
      this.disconnect(1002);
    }

    if (!decoded) return;

    new Message(decoded, this);
  };
  private error = (event: Event) => {};
  private onClose = (event: CloseEvent) => {
    this.ws.removeEventListener("open", this.open);
    this.ws.removeEventListener("message", this.message);
    this.ws.removeEventListener("error", this.error);
    this.ws.removeEventListener("close", this.onClose);

    this.emit("close", this.close.code || event.code, !!this.close.server);
    this.connected = false;
  };

  /**
   * Responds to the message
   * @param {any} data - Data to be sent
   * @param {Message} message - Message Class
   * @returns {void}
   */
  public respond = (data: any, message: Message): void => {
    this.sendRaw({ for: message.id, type: "response", data });
  };

  /**
   * Acknoledges the message
   * @param {Message} message - Message Class
   * @returns {void}
   */
  public acknoledge(message: Message): void {
    this.sendRaw({ for: message.id, type: "acknoledge" });
  }
}

interface DecodedMessage {
  id: number;
  type: string;
  data: any;
  system: boolean;
}
