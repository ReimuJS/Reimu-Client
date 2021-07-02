import { EventEmitter } from "events";
import Message from "./Message/index";
import * as msgpack from "msgpack-lite";

export class Reimu extends EventEmitter {
  constructor(
    url: string,
    options?: {
      pingTimeout?: number;
      responseTimeout?: number;
      reconnects?: number;
      reconnectTimeout?: number;
    }
  ) {
    super();

    this.options = {
      pingTimeout: options.pingTimeout || 5000,
      responseTimeout: options.responseTimeout || 15000,
      reconnects: options.reconnects || 10,
      reconnectTimeout: options.reconnectTimeout || 40000,
    };

    this.url = url;
    this.connect();
    this.messageId = 0;
    this.connected = false;
  }

  // Variables

  private url;
  private pingTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private ws?: WebSocket;
  private messageId;
  private connected: boolean;
  private reconnects: { reconnects: number; lastReconnect: Date } = {
    reconnects: 0,
    lastReconnect: new Date(),
  };

  /**
   * Options to be used
   * @type {Object<string, number>}
   */
  public options: {
    pingTimeout: number;
    responseTimeout: number;
    reconnects: number;
    reconnectTimeout: number;
  };

  /**
   * Last sent packet
   */
  public lastContact: { client: Date; server: Date } = {
    client: new Date(),
    server: new Date(),
  };

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

  private open = (event: Event) => {
    this.connected = true;
    this.close = undefined;

    this.pingTimer = setInterval(() => {
      this.ping();
    }, 500);

    this.reconnectTimer && clearInterval(this.reconnectTimer);

    this.lastContact = { client: new Date(), server: new Date() };

    this.sendRaw({ type: "batch", data: this.droppedPackets });
    this.emit("open");
  };

  private message = (event: MessageEvent) => {
    this.lastContact.server = new Date();

    let decoded: any;
    try {
      decoded = msgpack.decode(new Uint8Array(event.data));
    } catch (e) {
      this.disconnect(1002);
    }

    if (!decoded) return;

    new Message(decoded, this);
  };

  private onClose = (event: CloseEvent) => {
    !this.close && (this.close = { code: event.code, server: "unexpected" });

    this.Reconnect();
  };

  private Reconnect = () => {
    if (!this.close) return;

    this.pingTimer && clearInterval(this.pingTimer);

    if (
      new Date().getTime() - this.reconnects.lastReconnect.getTime() >
      this.options.reconnectTimeout
    )
      this.reconnects.reconnects = 0;
    this.reconnects.reconnects++;

    this.reconnects.lastReconnect = new Date();

    if (this.reconnects.reconnects > this.options.reconnects) {
      this.emit("close", this.close?.code, !!this.close?.server);
      return;
    }

    this.ws.removeEventListener("open", this.open);
    this.ws.removeEventListener("message", this.message);
    this.ws.removeEventListener("close", this.onClose);

    this.connected = false;

    if (["unexpected", "ping"].includes(this.close.server.toString())) {
      this.emit("reconnecting");
      this.connect();

      this.reconnectTimer = setTimeout(() => {
        this.emit("close", this.close?.code, !!this.close?.server);
      }, this.options.reconnectTimeout);
    } else {
      this.emit("close", this.close.code, this.close.server);
    }
  };

  private ping = () => {
    let pingTimeout = this.options.pingTimeout;

    if (this.close) {
      return;
    }

    // Safely assume a ping would be sent
    if (
      new Date().getTime() - this.lastContact.client.getTime() >
      pingTimeout / 2
    ) {
      this.sendRaw({ id: this.messageId++, type: "ping" });
    } else {
      // Now, check time between last client send and last server send
      if (
        this.lastContact.client.getTime() - this.lastContact.server.getTime() >
        pingTimeout
      ) {
        this.Reconnect();
      }
    }
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

export default interface WebSocketManager {
  /**
   * Emitted when the connection recieves a message
   */
  on(event: "message", callback: (message: Message) => void): this;

  /**
   * Emitted when the connection is closed
   */
  on(
    event: "close",
    callback: (code: number, server: boolean | "unexpected" | "ping") => void
  ): this;

  /**
   * Emitted when the connection opened or reconnected
   */
  on(event: "open", callback: () => void): this;

  /**
   * Emitted when the connection is reconnecting
   */
  on(event: "reconnecting", callback: () => void): this;
}

interface DecodedMessage {
  id: number;
  type: string;
  data: any;
  system: boolean;
}
